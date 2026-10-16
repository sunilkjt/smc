/**
 * Performance analytics over CLOSED paper trades. Unfilled setups are never
 * mixed in — callers pass only completed trades. Empty input yields an
 * honest zeroed result with `smallSample: true`, never fabricated numbers.
 *
 * Metrics: counts, win rate, expectancy (R), profit factor, average R,
 * max drawdown (on the cumulative-R curve), total R. Grouping helpers slice
 * by market / strategy / timeframe for the dashboard. Samples under 10
 * completed trades are flagged small-sample (under 30: interpret cautiously —
 * surfaced in UI copy).
 */
import type { ClosedTrade, PerformanceMetrics } from '../types.ts';

export const SMALL_SAMPLE_N = 10;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function maxDrawdownR(cumulative: number[]): number | null {
  if (cumulative.length === 0) return null;
  let peak = cumulative[0] ?? 0;
  let maxDd = 0;
  for (const v of cumulative) {
    if (v > peak) peak = v;
    maxDd = Math.min(maxDd, v - peak);
  }
  return maxDd;
}

/** Core metric computation from realized R multiples (fees already inside). */
export function summarizeR(realizedRs: number[]): PerformanceMetrics {
  const completed = realizedRs.length;
  const wins = realizedRs.filter((r) => r > 0);
  const losses = realizedRs.filter((r) => r <= 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const cumulative: number[] = [];
  let running = 0;
  for (const r of realizedRs) {
    running += r;
    cumulative.push(running);
  }
  return {
    signals: completed,
    activated: completed,
    completed,
    wins: wins.length,
    losses: losses.length,
    winRate: completed > 0 ? wins.length / completed : null,
    expectancyR: average(realizedRs),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null, // no losers → undefined, not infinite
    averageR: average(realizedRs),
    maxDrawdownR: maxDrawdownR(cumulative),
    totalR: running,
    smallSample: completed < SMALL_SAMPLE_N,
  };
}

/** Summarize closed trades (R comes from each trade's realizedR). */
export function summarizeTrades(trades: ClosedTrade[]): PerformanceMetrics {
  return summarizeR(trades.map((t) => t.realizedR));
}

export type GroupKey = 'market' | 'strategy' | 'timeframe';

/** Split trades into per-group metric blocks. Empty groups are omitted. */
export function groupTrades(
  trades: ClosedTrade[],
  by: GroupKey,
  timeframeOf: (trade: ClosedTrade) => string = () => 'unknown',
): Array<{ key: string; metrics: PerformanceMetrics }> {
  const buckets = new Map<string, ClosedTrade[]>();
  for (const t of trades) {
    const key = by === 'market' ? t.coin : by === 'strategy' ? t.strategy : timeframeOf(t);
    const list = buckets.get(key) ?? [];
    list.push(t);
    buckets.set(key, list);
  }
  return [...buckets.entries()].map(([key, list]) => ({ key, metrics: summarizeTrades(list) }));
}
