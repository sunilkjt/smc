import { useDiscovery } from '../hooks/useDiscovery.tsx';
import { useScanner } from '../hooks/useScanner.tsx';
import { fmtPx } from '../lib/format.ts';
import { unrealizedPnl } from '../lib/paper/engine.ts';

export default function PaperTrading() {
  const { signals, paper, resetPaper } = useScanner();
  const { result } = useDiscovery();
  const marks = new Map((result?.markets ?? []).map((m) => [m.id, m.markPx]));

  const floating = paper.openPositions.reduce((sum, p) => {
    const mark = marks.get(p.coin) ?? p.entry;
    return sum + unrealizedPnl(p, mark);
  }, 0);

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Paper Trading</h1>
        <span className="rounded bg-edge px-1.5 py-0.5 text-[11px] text-mute">simulated</span>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Reset the paper account? Closed-trade history will be cleared.')) {
              resetPaper();
            }
          }}
          className="ml-auto rounded-md border border-edge px-2 py-1 text-xs text-mute hover:text-ink"
        >
          Reset account
        </button>
      </div>

      <section className="grid gap-3 sm:grid-cols-4">
        {[
          ['Balance', `$${paper.balance.toFixed(2)}`],
          ['Starting', `$${paper.startingBalance.toFixed(2)}`],
          ['Open', String(paper.openPositions.length)],
          ['Floating', `${floating >= 0 ? '+' : ''}$${floating.toFixed(2)}`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-edge bg-panel p-3">
            <h2 className="text-xs font-medium text-mute">{label}</h2>
            <p className="mono mt-1 text-sm">{value}</p>
          </div>
        ))}
      </section>
      <p className="text-[11px] text-mute">
        Risk {paper.riskPct}% per trade · fee {(paper.feeRate * 100).toFixed(3)}% · slippage{' '}
        {(paper.slippageRate * 100).toFixed(2)}% · stop-first resolution · never real orders.
      </p>

      <section className="rounded-lg border border-edge bg-panel p-4">
        <h2 className="text-sm font-semibold">Open positions ({paper.openPositions.length})</h2>
        {paper.openPositions.length === 0 ? (
          <p className="mt-2 text-sm text-mute">
            None. Positions open automatically when a tracked signal fills (ACTIVE).
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-edge/60 text-sm">
            {paper.openPositions.map((p) => (
              <li key={p.id} className="py-2">
                <span className={`mono text-xs font-semibold ${p.direction === 'long' ? 'text-bull' : 'text-bear'}`}>
                  {p.direction === 'long' ? 'LONG' : 'SHORT'}
                </span>{' '}
                <span className="mono">{p.coin}</span>{' '}
                <span className="mono text-xs text-mute">
                  {p.size.toFixed(4)} @ {fmtPx(p.entry)} · SL {fmtPx(p.stopLoss)} · TP {fmtPx(p.takeProfit1)}/{fmtPx(p.takeProfit2)} · risk ${p.riskAmount.toFixed(2)}
                  {p.tp1Taken ? ' · TP1 taken' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-edge bg-panel p-4">
        <h2 className="text-sm font-semibold">Closed trades ({paper.closedTrades.length})</h2>
        {paper.closedTrades.length === 0 ? (
          <p className="mt-2 text-sm text-mute">None yet. Unresolved trades stay open — history is never rewritten.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-mute">
                  <th className="py-1 pr-3 font-medium">Trade</th>
                  <th className="py-1 pr-3 text-right font-medium">Exit</th>
                  <th className="py-1 pr-3 text-right font-medium">PnL</th>
                  <th className="py-1 text-right font-medium">R</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge/60">
                {paper.closedTrades.map((t) => (
                  <tr key={t.id}>
                    <td className="py-1 pr-3">
                      <span className="mono text-xs">{t.direction === 'long' ? 'LONG' : 'SHORT'} {t.coin}</span>{' '}
                      <span className="mono text-[11px] text-mute">{t.exitReason}{t.tp1Taken ? ' (TP1 partial)' : ''}</span>
                    </td>
                    <td className="mono py-1 pr-3 text-right text-xs">{fmtPx(t.exitPrice)}</td>
                    <td className={`mono py-1 pr-3 text-right text-xs ${t.realizedPnl >= 0 ? 'text-bull' : 'text-bear'}`}>
                      {t.realizedPnl >= 0 ? '+' : ''}${t.realizedPnl.toFixed(2)}
                    </td>
                    <td className={`mono py-1 text-right text-xs ${t.realizedR >= 0 ? 'text-bull' : 'text-bear'}`}>
                      {t.realizedR >= 0 ? '+' : ''}{t.realizedR.toFixed(2)}R
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {signals.length === 0 && (
        <p className="text-xs text-mute">No signals scanned yet — paper trading activates after the first scan.</p>
      )}
    </div>
  );
}
