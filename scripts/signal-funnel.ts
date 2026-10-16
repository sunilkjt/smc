/**
 * Signal funnel: market-by-market SMC stage diagnostics on live data.
 * For each verified market and direction, counts HOW FAR candidates get
 * (data → HTF context → sweep → post-sweep shift → zone → entry/SL/TP/RR)
 * and records the engine's authoritative first-failure reason. Also runs the
 * Technical Confluence evaluation on the SAME candles/timestamps for an
 * apples-to-apples rejection comparison. Read-only: writes a JSON artifact,
 * creates no signals, changes no thresholds.
 *
 * Env: TOP_N (default 8, max 15), OUT (default funnel-results.json).
 * Exit 1 on failure (never an empty "success").
 *
 * Usage: npm run funnel
 */
import { writeFileSync } from 'node:fs';
import { discoverStockMarkets } from '../src/lib/hyperliquid/index.ts';
import { DEFAULT_ENGINE_CONFIG } from '../src/lib/types.ts';
import { diagnoseMarket, type MarketDiagnosis } from '../src/lib/smc/funnel.ts';
import { fetchMarketCandles } from '../src/lib/scan.ts';
import { evaluateTech } from '../src/lib/tech/strategy.ts';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid ${name}=${raw}`);
  return n;
}

interface FunnelRow {
  coin: string;
  setupBars: number;
  dataAgeMin: number | null;
  longVerdict: string;
  shortVerdict: string;
  longStages: string;
  shortStages: string;
  tech: string;
}

async function main(): Promise<void> {
  const topN = Math.min(envInt('TOP_N', 8), 15);
  const out = process.env['OUT'] ?? 'funnel-results.json';
  const engine = { ...DEFAULT_ENGINE_CONFIG };

  const discovery = await discoverStockMarkets({ timeoutMs: 25000, maxRetries: 6 });
  console.log(`markets=${discovery.markets.length} excluded=${discovery.excludedCount}`);
  const targets = discovery.markets.slice(0, topN);

  const rows: FunnelRow[] = [];
  const reasonCounts = new Map<string, number>();
  const stagePass = new Map<string, { passed: number; total: number }>();
  let techLong = 0;
  let techShort = 0;
  let techNone = 0;
  const bump = (reason: string): void => {
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  };

  const scannedAt = Date.now();
  for (const market of targets) {
    try {
      const { context, setup } = await fetchMarketCandles(market.id, engine);
      const diagnosis: MarketDiagnosis = diagnoseMarket(market.id, context, setup, engine, scannedAt);
      const tech = evaluateTech({ coin: market.id, candles: setup, htf: context });
      if (tech.direction === 'long') techLong += 1;
      else if (tech.direction === 'short') techShort += 1;
      else techNone += 1;
      bump(`long:${diagnosis.long.verdict}`);
      bump(`short:${diagnosis.short.verdict}`);
      for (const side of [diagnosis.long, diagnosis.short]) {
        for (const stage of side.stages) {
          const entry = stagePass.get(stage.stage) ?? { passed: 0, total: 0 };
          entry.total += 1;
          if (stage.passed) entry.passed += 1;
          stagePass.set(stage.stage, entry);
        }
      }
      const flags = (d: MarketDiagnosis['long']): string =>
        d.stages.map((s) => (s.passed ? '+' : '-')).join('');
      rows.push({
        coin: market.id,
        setupBars: diagnosis.setupBars,
        dataAgeMin: diagnosis.dataAgeMs == null ? null : Math.round(diagnosis.dataAgeMs / 60000),
        longVerdict: diagnosis.long.verdict,
        shortVerdict: diagnosis.short.verdict,
        longStages: flags(diagnosis.long),
        shortStages: flags(diagnosis.short),
        tech: tech.direction,
      });
      console.log(
        `${market.id} [${diagnosis.setupBars} bars, age ${rows[rows.length - 1]?.dataAgeMin}m] ` +
          `long=${diagnosis.long.verdict} (${flags(diagnosis.long)}) ` +
          `short=${diagnosis.short.verdict} (${flags(diagnosis.short)}) ` +
          `tech=${tech.direction}`,
      );
    } catch (err) {
      console.log(`${market.id}: FETCH FAILED — ${err instanceof Error ? err.message : String(err)}`);
      rows.push({
        coin: market.id, setupBars: 0, dataAgeMin: null,
        longVerdict: 'FETCH_FAILED', shortVerdict: 'FETCH_FAILED',
        longStages: '', shortStages: '', tech: 'unknown',
      });
    }
  }

  console.log('\nStage legend: data,htf-context,liquidity-sweep,structure-shift,entry-zone,entry-sl-tp-rr (+=pass,-=fail)');
  console.log('\nStage pass rates (16 evaluations = 8 markets × long/short):');
  for (const [stage, counts] of stagePass) {
    console.log(`  ${stage}: ${counts.passed}/${counts.total}`);
  }
  console.log('\nVerdict histogram:');
  for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }
  console.log(`\nTech on identical candles: long=${techLong} short=${techShort} none=${techNone}`);

  writeFileSync(out, JSON.stringify({ scannedAt, rows, reasonCounts: Object.fromEntries(reasonCounts) }, null, 2));
  console.log(`Wrote ${out}`);
}

main().catch((err: unknown) => {
  console.error(`FUNNEL FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
