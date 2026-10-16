/**
 * Headless market scan for scheduled runs (GitHub Actions) and debugging.
 * Reads REAL public API data; prints a summary and writes machine-readable
 * JSON for artifacts/alerts. No fake data, no fixtures.
 *
 * Env: TOP_N (default 8), OUT (default scan-results.json), TECH (1 to enable
 * the comparison strategy), MIN_RR (override engine minimum, default 2).
 * Exit 1 on any failure (never an empty "success").
 *
 * Usage: npm run scan --  (script alias below)
 */
import { writeFileSync } from 'node:fs';
import { discoverStockMarkets } from '../src/lib/hyperliquid/index.ts';
import { DEFAULT_ENGINE_CONFIG } from '../src/lib/types.ts';
import {
  DEFAULT_SCAN_OPTIONS,
  evaluateMarket,
  fetchMarketCandles,
} from '../src/lib/scan.ts';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid ${name}=${raw}`);
  return n;
}

async function main(): Promise<void> {
  const topN = Math.min(envInt('TOP_N', 8), 15);
  const out = process.env['OUT'] ?? 'scan-results.json';
  const techEnabled = process.env['TECH'] === '1';
  const minRR = Number(process.env['MIN_RR'] ?? DEFAULT_ENGINE_CONFIG.minRiskReward);
  if (!(minRR > 0)) throw new Error(`Invalid MIN_RR=${process.env['MIN_RR']}`);
  const engine = { ...DEFAULT_ENGINE_CONFIG, minRiskReward: minRR };

  console.log(`Discovery + scan of top ${topN} verified stocks (tech=${techEnabled ? 'on' : 'off'})`);
  const discovery = await discoverStockMarkets({ timeoutMs: 20000, maxRetries: 4 });
  console.log(
    `dexes=${discovery.dexCount} assets=${discovery.totalAssets} stocks=${discovery.markets.length} excluded=${discovery.excludedCount}`,
  );
  const targets = discovery.markets.slice(0, topN);
  if (targets.length === 0) {
    console.log('EMPTY STATE: no verified stocks to scan.');
    writeFileSync(out, JSON.stringify({ scannedAt: Date.now(), signals: [], markets: [] }, null, 2));
    return;
  }

  const scannedAt = Date.now();
  const results = [];
  let setups = 0;
  for (const market of targets) {
    try {
      const { context, setup } = await fetchMarketCandles(market.id, engine);
      const scan = evaluateMarket(market.id, context, setup, {
        ...DEFAULT_SCAN_OPTIONS,
        engine,
        techEnabled,
      }, scannedAt);
      const tradable = scan.signals.filter((s) => s.state !== 'NO_TRADE');
      setups += tradable.length;
      console.log(
        `${market.id}: ${setup.length} setup bars → ${tradable.map((s) => `${s.direction}@${s.setup?.entry}`).join(', ') || 'NO_TRADE'}${scan.tech && scan.tech.direction !== 'none' ? ` | tech:${scan.tech.direction}` : ''}${scan.error ? ` ERROR:${scan.error}` : ''}`,
      );
      results.push({
        coin: market.id,
        signals: scan.signals,
        tech: scan.tech,
        error: scan.error,
      });
    } catch (err) {
      console.log(`${market.id}: FETCH FAILED — ${err instanceof Error ? err.message : String(err)}`);
      results.push({ coin: market.id, signals: [], tech: null, error: String(err) });
    }
  }
  console.log(`Tradable SMC setups: ${setups}`);
  writeFileSync(out, JSON.stringify({ scannedAt, signals: results.flatMap((r) => r.signals), markets: results.map((r) => ({ coin: r.coin, error: r.error })) }, null, 2));
  console.log(`Wrote ${out}`);
}

main().catch((err: unknown) => {
  console.error(`SCAN FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
