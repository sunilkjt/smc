import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDiscovery } from '../hooks/useDiscovery.tsx';
import { dayChangePct, fmtCompact, fmtPct, fmtPx, timeAgo } from '../lib/format.ts';

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'live' ? 'bg-bull' : status === 'loading' || status === 'idle' ? 'bg-gold' : 'bg-bear';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

export default function Dashboard() {
  const { status, result, error, lastSuccessAt, refresh } = useDiscovery();
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<'all' | 'long' | 'short'>('all');

  const markets = useMemo(() => {
    const list = result?.markets ?? [];
    const q = query.trim().toLowerCase();
    return q ? list.filter((m) => m.id.toLowerCase().includes(q)) : list;
  }, [result, query]);

  const stale = lastSuccessAt != null && Date.now() - lastSuccessAt > 5 * 60_000;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <section className="rounded-lg border border-edge bg-panel p-3">
          <h2 className="text-xs font-medium text-mute">Data connection</h2>
          <p className="mt-1 flex items-center gap-2 text-sm">
            <StatusDot status={status} />
            {status === 'live' && !stale && 'Live'}
            {status === 'live' && stale && 'Live (stale)'}
            {status === 'loading' && 'Connecting…'}
            {status === 'idle' && 'Idle'}
            {status === 'error' && 'Error'}
          </p>
          <p className="mono mt-1 text-[11px] text-mute">
            {lastSuccessAt ? `fresh ${timeAgo(lastSuccessAt)}` : 'no successful scan yet'}
          </p>
        </section>
        <section className="rounded-lg border border-edge bg-panel p-3">
          <h2 className="text-xs font-medium text-mute">Last successful scan</h2>
          <p className="mono mt-1 text-sm">
            {lastSuccessAt ? new Date(lastSuccessAt).toLocaleTimeString('en-GB') : '—'}
          </p>
          <button
            type="button"
            onClick={refresh}
            className="mt-1 rounded-md border border-edge px-2 py-0.5 text-xs text-mute hover:text-ink"
          >
            Rescan
          </button>
        </section>
        <section className="rounded-lg border border-edge bg-panel p-3">
          <h2 className="text-xs font-medium text-mute">Verified stock markets</h2>
          <p className="mono mt-1 text-sm">
            {result ? `${result.markets.length} / ${result.totalAssets} assets` : '—'}
          </p>
          <p className="mt-1 text-[11px] text-mute">
            {result ? `${result.excludedCount} excluded (non-equity / unknown)` : 'discovery pending'}
          </p>
        </section>
        <section className="rounded-lg border border-edge bg-panel p-3">
          <h2 className="text-xs font-medium text-mute">Paper positions</h2>
          <p className="mt-1 text-sm">None — engine lands in Phase 5</p>
          <p className="mt-1 text-[11px] text-mute">Simulated only, never real orders</p>
        </section>
      </div>

      {error && !result && (
        <div className="rounded-lg border border-bear/50 bg-panel p-4 text-sm">
          <p className="font-medium text-bear">Market data unavailable</p>
          <p className="mono mt-1 text-xs text-mute">{error}</p>
          <p className="mt-1 text-xs text-mute">
            This is a connection failure, not an empty market list.{' '}
            <button type="button" onClick={refresh} className="underline hover:text-ink">
              Retry
            </button>
          </p>
        </div>
      )}

      <section className="rounded-lg border border-edge bg-panel p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Strongest SMC setups</h2>
          <span className="rounded bg-edge px-1.5 py-0.5 text-[11px] text-mute">valid only</span>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter market…"
              className="rounded-md border border-edge bg-board px-2 py-1 text-xs text-ink placeholder:text-mute"
            />
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'all' | 'long' | 'short')}
              className="rounded-md border border-edge bg-board px-2 py-1 text-xs"
              aria-label="Direction filter"
            >
              <option value="all">All directions</option>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </div>
        </div>
        <div className="mt-3 rounded-md border border-edge/70 bg-board p-4 text-sm text-mute">
          No validated SMC setups right now. The deterministic SMC engine (swings, BOS/CHoCH,
          liquidity sweeps, FVG, order blocks, multi-timeframe confirmation) lands in Phase 4 —
          until then this list stays honestly empty instead of showing weak or invented signals.
          {direction !== 'all' && (
            <span className="mono text-[11px]"> (direction filter: {direction})</span>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-edge bg-panel p-4">
        <h2 className="text-sm font-semibold">Most liquid verified stocks</h2>
        {status === 'loading' || status === 'idle' ? (
          <p className="mt-2 text-sm text-mute">Discovering markets…</p>
        ) : markets.length === 0 ? (
          <p className="mt-2 text-sm text-mute">
            {result
              ? 'No markets meet the verification criteria right now.'
              : 'Market list unavailable — see the connection status above.'}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-edge/60 text-sm">
            {markets.slice(0, 8).map((m) => {
              const chg = dayChangePct(m.markPx, m.prevDayPx);
              const up = (chg ?? 0) >= 0;
              return (
                <li key={m.id} className="flex items-center gap-3 py-1.5">
                  <Link
                    to={`/signal/${encodeURIComponent(m.id)}`}
                    className="mono font-medium hover:underline"
                  >
                    {m.id}
                  </Link>
                  <span className="mono text-mute">{fmtPx(m.markPx)}</span>
                  <span className={`mono ${up ? 'text-bull' : 'text-bear'}`}>{fmtPct(chg)}</span>
                  <span className="mono ml-auto text-[11px] text-mute">
                    24h vol {fmtCompact(m.dayNtlVlm)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
