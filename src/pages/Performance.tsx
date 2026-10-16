import { useMemo } from 'react';
import { useScanner } from '../hooks/useScanner.tsx';
import { groupTrades, summarizeTrades } from '../lib/analytics/performance.ts';
import type { PerformanceMetrics } from '../lib/types.ts';

function pct(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}

function num(v: number | null, digits = 2): string {
  return v == null ? '—' : v.toFixed(digits);
}

function MetricCards({ m }: { m: PerformanceMetrics }) {
  const cards: Array<[string, string]> = [
    ['Completed trades', String(m.completed)],
    ['Win rate', pct(m.winRate)],
    ['Expectancy', m.expectancyR == null ? '—' : `${m.expectancyR >= 0 ? '+' : ''}${m.expectancyR.toFixed(2)}R`],
    ['Profit factor', num(m.profitFactor)],
    ['Average R', m.averageR == null ? '—' : `${m.averageR >= 0 ? '+' : ''}${m.averageR.toFixed(2)}R`],
    ['Max drawdown', m.maxDrawdownR == null ? '—' : `${m.maxDrawdownR.toFixed(2)}R`],
    ['Total R', `${m.totalR >= 0 ? '+' : ''}${m.totalR.toFixed(2)}R`],
    ['W / L', `${m.wins} / ${m.losses}`],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-edge bg-panel p-3">
          <h3 className="text-xs font-medium text-mute">{label}</h3>
          <p className="mono mt-1 text-sm">{value}</p>
        </div>
      ))}
    </div>
  );
}

export default function Performance() {
  const { paper, signals } = useScanner();
  const overall = useMemo(() => summarizeTrades(paper.closedTrades), [paper.closedTrades]);
  const byStrategy = useMemo(() => groupTrades(paper.closedTrades, 'strategy'), [paper.closedTrades]);
  const byMarket = useMemo(() => groupTrades(paper.closedTrades, 'market'), [paper.closedTrades]);
  const unfilled = signals.filter((s) => s.setup != null && s.state === 'WAITING_FOR_RETEST').length;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Strategy Performance</h1>
      {(overall.smallSample || paper.closedTrades.length < 30) && (
        <p className="rounded-lg border border-gold/40 bg-panel p-3 text-xs text-mute">
          {paper.closedTrades.length === 0
            ? 'No completed paper trades yet — metrics appear here once trades resolve. Unfilled setups are tracked separately and never counted as trades.'
            : `Small sample (${paper.closedTrades.length} completed): treat win rate and expectancy as indicative only. Unfilled setups waiting: ${unfilled}.`}
        </p>
      )}
      <MetricCards m={overall} />
      {byStrategy.length > 0 && (
        <section className="rounded-lg border border-edge bg-panel p-4">
          <h2 className="text-sm font-semibold">By strategy (SMC vs Tech kept separate)</h2>
          <ul className="mono mt-2 space-y-1 text-xs text-mute">
            {byStrategy.map((g) => (
              <li key={g.key}>
                {g.key}: {g.metrics.completed} trades · win {pct(g.metrics.winRate)} · exp{' '}
                {num(g.metrics.expectancyR)}R · PF {num(g.metrics.profitFactor)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {byMarket.length > 0 && (
        <section className="rounded-lg border border-edge bg-panel p-4">
          <h2 className="text-sm font-semibold">By market</h2>
          <ul className="mono mt-2 space-y-1 text-xs text-mute">
            {byMarket.map((g) => (
              <li key={g.key}>
                {g.key}: {g.metrics.completed} trades · win {pct(g.metrics.winRate)} · total{' '}
                {g.metrics.totalR >= 0 ? '+' : ''}{g.metrics.totalR.toFixed(2)}R
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
