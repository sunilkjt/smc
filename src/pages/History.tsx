import { Link } from 'react-router-dom';
import { useScanner } from '../hooks/useScanner.tsx';
import { fmtPx, fmtTime } from '../lib/format.ts';

export default function History() {
  const { signals } = useScanner();
  const tracked = signals.filter((s) => s.state !== 'NO_TRADE');

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Signal History</h1>
      {tracked.length === 0 ? (
        <div className="rounded-lg border border-edge bg-panel p-6 text-center text-sm text-mute">
          No tracked signals yet. Run a scan from the Dashboard — WAITING_FOR_SETUP, ACTIVE,
          INVALIDATED, EXPIRED and RESOLVED signals with full event history appear here.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-edge">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-panel text-left text-xs text-mute">
                <th className="px-3 py-2 font-medium">Signal</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2 text-right font-medium">Entry / SL / TP1</th>
                <th className="px-3 py-2 text-right font-medium">Signal time</th>
                <th className="px-3 py-2 font-medium">Resolution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/60 bg-board">
              {tracked.map((s) => (
                <tr key={s.id} className="hover:bg-panel/60">
                  <td className="px-3 py-1.5">
                    <Link to={`/signal/${encodeURIComponent(s.coin)}`} className="mono hover:underline">
                      {s.direction === 'long' ? 'BUY' : 'SELL'} {s.coin}
                    </Link>{' '}
                    <span className="mono text-[11px] text-mute">
                      {s.setupTimeframe} {s.strategy === 'tech' ? '· TECH' : '· SMC'}
                    </span>
                  </td>
                  <td className="mono px-3 py-1.5 text-xs">{s.state}</td>
                  <td className="mono px-3 py-1.5 text-right text-xs">
                    {s.setup ? `${fmtPx(s.setup.entry)} / ${fmtPx(s.setup.stopLoss)} / ${fmtPx(s.setup.takeProfit1)}` : '—'}
                  </td>
                  <td className="mono px-3 py-1.5 text-right text-xs text-mute">
                    {s.setup ? fmtTime(s.setup.signalTime) : fmtTime(s.createdAt)}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-mute">{s.resolution ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
