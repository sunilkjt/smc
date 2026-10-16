/**
 * Walk-forward / out-of-sample evaluation with FROZEN parameters.
 * Replays the production engine + accounting over fixed historical windows —
 * no tuning, no optimization loop exists anywhere in this pipeline.
 *
 * Design (documented, fixed):
 * - Universe: top TOP_N (default 3) verified stocks by 24h notional.
 * - History: up to 5000 15m setup bars (~52d, API cap) + aligned 1h context.
 * - Cutoffs: WF_CUTOFFS (default 8) fixed steps of WF_STEP_DAYS (default 6)
 *   ending at the latest bar. Each cutoff sees ONLY bars with
 *   closeTime <= cutoff (causal slices; enforced structurally).
 * - Forward: up to 500 setup bars after each cutoff for fill/resolution with
 *   the exact live fill/cost rules (strict penetration, stop-first, fees,
 *   slippage, TP1-half + runner).
 * - Engine config: DEFAULT_ENGINE_CONFIG verbatim (MIN_RR overridable for
 *   sensitivity display ONLY via MIN_RR env, default 2 — reported, not tuned).
 * Caveats printed with the report: survivorship (only currently-listed
 * markets), 15m granularity, shared-IP rate limits (sequential, retried).
 *
 * Usage: npm run walkforward
 */
import { writeFileSync } from 'node:fs';
import { discoverStockMarkets, fetchCandles } from '../src/lib/hyperliquid/index.ts';
import { INTERVAL_MS } from '../src/lib/hyperliquid/candles.ts';
import { summarizeTrades } from '../src/lib/analytics/performance.ts';
import { DEFAULT_ENGINE_CONFIG } from '../src/lib/types.ts';
import {
  buildCutoffs,
  replayCutoff,
  type CutoffOutcome,
} from '../src/lib/ops/walkforward.ts';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid ${name}=${raw}`);
  return n;
}

async function main(): Promise<void> {
  const topN = Math.min(envInt('TOP_N', 3), 8);
  const cutoffs = envInt('WF_CUTOFFS', 8);
  const stepDays = envInt('WF_STEP_DAYS', 6);
  const minRR = Number(process.env['MIN_RR'] ?? DEFAULT_ENGINE_CONFIG.minRiskReward);
  if (!(minRR > 0)) throw new Error(`Invalid MIN_RR=${process.env['MIN_RR']}`);
  const engine = { ...DEFAULT_ENGINE_CONFIG, minRiskReward: minRR };
  const out = process.env['OUT'] ?? 'walkforward-report.md';

  console.log(`Walk-forward: top ${topN} stocks, ${cutoffs} cutoffs every ${stepDays}d, frozen config (minRR=${minRR})`);
  const discovery = await discoverStockMarkets({ timeoutMs: 25000, maxRetries: 6 });
  const targets = discovery.markets.slice(0, topN);
  if (targets.length === 0) {
    console.log('EMPTY STATE: no verified stocks.');
    return;
  }

  const setupMs = INTERVAL_MS[engine.setupTimeframe];
  const ctxMs = INTERVAL_MS[engine.contextTimeframe];
  const lines: string[] = [
    '# Walk-forward evaluation (frozen parameters, out-of-sample replay)',
    '',
    `Engine: DEFAULT_ENGINE_CONFIG verbatim (minRR=${minRR}); fill/cost rules identical to live paper trading.`,
    `Caveats: only currently-listed markets (survivorship); 15m granularity with stop-first pessimism; fees+slippage included.`,
    '',
    '| Market | Cutoff (UTC) | Setups | Filled | Closed | Net R |',
    '|---|---|---|---|---|---|',
  ];
  let totalR = 0;
  let totalTrades = 0;
  for (const market of targets) {
    try {
      const now = Date.now();
      const setup = await fetchCandles(market.id, engine.setupTimeframe, now - 5000 * setupMs, now, { now, timeoutMs: 25000, maxRetries: 6 });
      const context = await fetchCandles(market.id, engine.contextTimeframe, now - 1400 * ctxMs, now, { now, timeoutMs: 25000, maxRetries: 6 });
      const lastEnd = setup.closed.length > 0 ? (setup.closed[setup.closed.length - 1]?.closeTime ?? now) : now;
      const grid = buildCutoffs(lastEnd, stepDays * 86_400_000, cutoffs);
      // Replay each cutoff exactly once; reuse outcomes for rows + summary.
      const outcomes: CutoffOutcome[] = grid.map((cutoff) =>
        replayCutoff(market.id, setup.closed, context.closed, cutoff, engine, cutoff),
      );
      let marketR = 0;
      let marketTrades = 0;
      for (const outcome of outcomes) {
        const net = outcome.trades.reduce((a, t) => a + t.realizedR, 0);
        marketR += net;
        marketTrades += outcome.trades.length;
        lines.push(
          `| ${market.id} | ${new Date(outcome.cutoff).toISOString().slice(0, 10)} | ${outcome.setups} | ${outcome.filled} | ${outcome.trades.length} | ${net >= 0 ? '+' : ''}${net.toFixed(2)} |`,
        );
      }
      const summary = summarizeTrades(outcomes.flatMap((o) => o.trades));
      totalR += marketR;
      totalTrades += marketTrades;
      console.log(
        `${market.id}: ${marketTrades} closed / ${outcomes.reduce((a, o) => a + o.openLeft, 0)} left open, ` +
        `win ${summary.winRate == null ? 'n/a' : `${(summary.winRate * 100).toFixed(0)}%`}, exp ${summary.expectancyR == null ? 'n/a' : `${summary.expectancyR.toFixed(2)}R`}`,
      );
    } catch (err) {
      lines.push(`| ${market.id} | — | fetch failed: ${err instanceof Error ? err.message : String(err)} | | | |`);
    }
  }
  lines.push('', `Totals: ${totalTrades} closed window-trades, net ${totalR >= 0 ? '+' : ''}${totalR.toFixed(2)}R.`);
  lines.push('', '_Windows overlap by design (each cutoff replays independently); totals describe coverage, not a compounded track record. Small samples: interpret with the Performance page warnings._');
  const markdown = lines.join('\n');
  console.log(markdown);
  writeFileSync(out, `${markdown}\n`);
  console.log(`Wrote ${out}`);
}

main().catch((err: unknown) => {
  console.error(`WALKFORWARD FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
