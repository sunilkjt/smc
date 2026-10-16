/**
 * Evaluation report runner: loads completed paper trades + signals from
 * Supabase, classifies each trade's market regime from daily candles, and
 * writes a markdown SMC-vs-Tech comparison. Unfilled setups never enter the
 * numbers; empty history yields an honest empty report (exit 0).
 * Regime dailies are fetched per coin sequentially (rate-limit friendly).
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Skips gracefully
 * without them (exit 0 — nothing to evaluate, not a failure).
 *
 * Usage: npm run eval
 */
import { writeFileSync } from 'node:fs';
import { fetchCandles } from '../src/lib/hyperliquid/candles.ts';
import {
  buildEvalReport,
  REGIME_LOOKBACK_DAYS,
  renderEvalReport,
} from '../src/lib/analytics/eval-report.ts';
import {
  loadSignals,
  loadTrades,
  validateSbConfig,
  type SbConfig,
} from '../src/lib/supabase-sync.ts';
import type { ClosedTrade } from '../src/lib/types.ts';

function isClosed(p: { status: string }): p is ClosedTrade {
  return p.status === 'closed';
}

/** 60d daily return ending at `asOf` (null when unavailable — never guessed). */
async function regimeReturn(coin: string, asOf: number): Promise<number | null> {
  try {
    const dayMs = 86_400_000;
    const end = asOf;
    const start = asOf - (REGIME_LOOKBACK_DAYS + 5) * dayMs;
    const set = await fetchCandles(coin, '1d', start, end, { now: end, timeoutMs: 20000, maxRetries: 4 });
    const closes = set.closed.map((c) => c.close).filter((v) => v > 0);
    if (closes.length < REGIME_LOOKBACK_DAYS) return null;
    const first = closes[closes.length - REGIME_LOOKBACK_DAYS - 1] ?? closes[0] ?? 0;
    const last = closes[closes.length - 1] ?? 0;
    if (!(first > 0) || !(last > 0)) return null;
    return last / first - 1;
  } catch {
    return null; // fetch failure → unclassified, reported as such
  }
}

async function main(): Promise<void> {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    console.log('SKIP: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (nothing to evaluate).');
    return;
  }
  const cfg: SbConfig = { url, key };
  validateSbConfig(cfg);
  const out = process.env['OUT'] ?? 'eval-report.md';

  const { signals } = await loadSignals(cfg);
  const trades = await loadTrades(cfg);
  const closed = trades.closed.filter(isClosed);
  console.log(`loaded ${closed.length} completed trades, ${signals.length} signals`);
  const signalsById = new Map(signals.map((s) => [s.id, s]));

  const regimes = new Map<string, number | null>();
  const byCoin = new Map<string, ClosedTrade[]>();
  for (const t of closed) {
    const list = byCoin.get(t.coin) ?? [];
    list.push(t);
    byCoin.set(t.coin, list);
  }
  for (const [coin, list] of byCoin) {
    const asOf = Math.max(...list.map((t) => t.openedAt));
    const ret = await regimeReturn(coin, asOf);
    for (const t of list) regimes.set(t.id, ret);
    console.log(`${coin}: ${list.length} trade(s), 60d return ${ret == null ? 'n/a' : `${(ret * 100).toFixed(1)}%`}`);
  }

  const report = buildEvalReport(closed, regimes, signalsById);
  const markdown = renderEvalReport(report);
  console.log(markdown);
  writeFileSync(out, `${markdown}\n`);
  console.log(`Wrote ${out}`);
}

main().catch((err: unknown) => {
  console.error(`EVAL FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
