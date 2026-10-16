import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDiscovery } from '../hooks/useDiscovery.tsx';
import { dayChangePct, fmtCompact, fmtPct, fmtPx } from '../lib/format.ts';

export default function Markets() {
  const { status, result, error, refresh } = useDiscovery();
  const [query, setQuery] = useState('');

  const markets = useMemo(() => {
    const list = result?.markets ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (m) => m.id.toLowerCase().includes(q) || (m.dexFullName ?? '').toLowerCase().includes(q),
    );
  }, [result, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Stock Markets</h1>
        <span className="mono text-xs text-mute">
          {result ? `${markets.length} verified · ${result.excludedCount} excluded` : status}
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search markets…"
          className="ml-auto rounded-md border border-edge bg-panel px-2 py-1 text-sm placeholder:text-mute"
        />
      </div>

      {error && !result && (
        <div className="rounded-lg border border-bear/50 bg-panel p-4 text-sm">
          <p className="font-medium text-bear">Could not load markets: connection failure.</p>
          <p className="mono mt-1 text-xs text-mute">{error}</p>
          <button type="button" onClick={refresh} className="mt-2 underline text-xs">
            Retry
          </button>
        </div>
      )}

      {result && result.markets.length === 0 && (
        <div className="rounded-lg border border-edge bg-panel p-6 text-center text-sm text-mute">
          No markets currently meet the stock-verification criteria. Non-equity and unclassified
          markets ({result.excludedCount}) are excluded rather than guessed.
        </div>
      )}

      {markets.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-edge">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-panel text-left text-xs text-mute">
                <th className="px-3 py-2 font-medium">Market</th>
                <th className="px-3 py-2 font-medium">DEX</th>
                <th className="px-3 py-2 text-right font-medium">Mark</th>
                <th className="px-3 py-2 text-right font-medium">24h Δ</th>
                <th className="px-3 py-2 text-right font-medium">24h notional</th>
                <th className="px-3 py-2 text-right font-medium">Max lev</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/60 bg-board">
              {markets.map((m) => {
                const chg = dayChangePct(m.markPx, m.prevDayPx);
                return (
                  <tr key={m.id} className="hover:bg-panel/60">
                    <td className="px-3 py-1.5">
                      <Link
                        to={`/signal/${encodeURIComponent(m.id)}`}
                        className="mono font-medium hover:underline"
                      >
                        {m.id}
                      </Link>
                      {m.onlyIsolated && (
                        <span className="ml-2 rounded bg-edge px-1 text-[10px] text-mute">
                          isolated-only
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-mute">{m.dexFullName ?? m.dex}</td>
                    <td className="mono px-3 py-1.5 text-right">{fmtPx(m.markPx)}</td>
                    <td
                      className={`mono px-3 py-1.5 text-right ${(chg ?? 0) >= 0 ? 'text-bull' : 'text-bear'}`}
                    >
                      {fmtPct(chg)}
                    </td>
                    <td className="mono px-3 py-1.5 text-right text-mute">
                      {fmtCompact(m.dayNtlVlm)}
                    </td>
                    <td className="mono px-3 py-1.5 text-right text-mute">{m.maxLeverage}x</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
