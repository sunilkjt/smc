/**
 * Reproducible SMC-vs-Tech evaluation report from COMPLETED paper trades.
 * Unfilled setups never enter these numbers; net R is after costs (fees and
 * slippage are already inside realizedPnl). Empty input prints an honest
 * empty report — never fabricated statistics, never a profitability claim
 * without sample sizes shown.
 *
 * Regime buckets (reporting-only, frozen here, not strategy parameters):
 * each trade's coin is classified by its own 60-day daily return ending at
 * the trade's open date: > +15% bull, < -15% bear, else range. Thresholds are
 * documented here and fixed; changing them is out of scope for this report.
 */
import type { ClosedTrade, PerformanceMetrics, Signal } from '../types.ts';
import { groupTrades, summarizeTrades } from './performance.ts';

export type Regime = 'bull' | 'bear' | 'range' | 'unknown';

export const REGIME_UP_PCT = 0.15;
export const REGIME_DOWN_PCT = -0.15;
export const REGIME_LOOKBACK_DAYS = 60;

export function classifyRegime(returnPct: number | null): Regime {
  if (returnPct == null || !Number.isFinite(returnPct)) return 'unknown';
  if (returnPct > REGIME_UP_PCT) return 'bull';
  if (returnPct < REGIME_DOWN_PCT) return 'bear';
  return 'range';
}

export interface EvalReport {
  generatedAt: number;
  trades: number;
  overall: PerformanceMetrics;
  byStrategy: Array<{ key: string; metrics: PerformanceMetrics }>;
  byMarket: Array<{ key: string; metrics: PerformanceMetrics }>;
  byTimeframe: Array<{ key: string; metrics: PerformanceMetrics }>;
  byRegime: Array<{ key: string; metrics: PerformanceMetrics }>;
  /** Trade ids that could not be regime-classified (missing data). */
  unclassified: string[];
}

function pct(v: number | null): string {
  return v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`;
}

function r(v: number | null): string {
  if (v == null) return 'n/a';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`;
}

/**
 * Build the report. `regimes` maps trade id → 60d daily return at open
 * (null when unavailable); timeframes resolve via each trade's signal.
 */
export function buildEvalReport(
  trades: ClosedTrade[],
  regimes: Map<string, number | null>,
  signalsById: Map<string, Signal>,
  generatedAt = Date.now(),
): EvalReport {
  const byRegimeBuckets = new Map<string, ClosedTrade[]>();
  const unclassified: string[] = [];
  for (const t of trades) {
    const regime = classifyRegime(regimes.has(t.id) ? (regimes.get(t.id) as number | null) : null);
    if (regime === 'unknown') unclassified.push(t.id);
    const list = byRegimeBuckets.get(regime) ?? [];
    list.push(t);
    byRegimeBuckets.set(regime, list);
  }
  const timeframeOf = (t: ClosedTrade): string =>
    signalsById.get(t.signalId)?.setupTimeframe ?? 'unknown';
  return {
    generatedAt,
    trades: trades.length,
    overall: summarizeTrades(trades),
    byStrategy: groupTrades(trades, 'strategy'),
    byMarket: groupTrades(trades, 'market'),
    byTimeframe: groupTrades(trades, 'timeframe', timeframeOf),
    byRegime: [...byRegimeBuckets.entries()]
      .filter(([key]) => key !== 'unknown')
      .map(([key, list]) => ({ key, metrics: summarizeTrades(list) })),
    unclassified,
  };
}

function metricLine(label: string, m: PerformanceMetrics): string {
  return (
    `${label}: n=${m.completed} win=${pct(m.winRate)} exp=${r(m.expectancyR)} ` +
    `PF=${m.profitFactor == null ? 'n/a' : m.profitFactor.toFixed(2)} ` +
    `avg=${r(m.averageR)} DD=${m.maxDrawdownR == null ? 'n/a' : `${m.maxDrawdownR.toFixed(2)}R`} ` +
    `total=${r(m.totalR)}${m.smallSample ? ' [SMALL SAMPLE]' : ''}`
  );
}

/** Render the report as markdown (stdout + artifact). */
export function renderEvalReport(report: EvalReport): string {
  const lines: string[] = [
    '# SMC vs Technical Confluence — evaluation (completed paper trades only)',
    '',
    `Generated: ${new Date(report.generatedAt).toISOString()}`,
    `Trades evaluated: ${report.trades} (unfilled setups excluded; R is net of fees/slippage)`,
    '',
    '## Overall',
    metricLine('all', report.overall),
    '',
    '## By strategy (separate histories, shared accounting rules)',
  ];
  for (const g of report.byStrategy) lines.push(metricLine(`- ${g.key}`, g.metrics));
  lines.push('', '## By market');
  if (report.byMarket.length === 0) lines.push('(none)');
  for (const g of report.byMarket) lines.push(metricLine(`- ${g.key}`, g.metrics));
  lines.push('', '## By setup timeframe');
  if (report.byTimeframe.length === 0) lines.push('(none)');
  for (const g of report.byTimeframe) lines.push(metricLine(`- ${g.key}`, g.metrics));
  lines.push('', `## By regime (coin 60d daily return at open: bull > +15%, bear < -15%, else range)`);
  if (report.byRegime.length === 0) lines.push('(none)');
  for (const g of report.byRegime) lines.push(metricLine(`- ${g.key}`, g.metrics));
  if (report.unclassified.length > 0) {
    lines.push('', `Unclassified by regime (${report.unclassified.length}): ${report.unclassified.slice(0, 10).join(', ')}${report.unclassified.length > 10 ? '…' : ''}`);
  }
  return lines.join('\n');
}
