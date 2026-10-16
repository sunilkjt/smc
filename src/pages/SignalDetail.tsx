import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import CandleChart from '../components/CandleChart.tsx';
import { fetchCandles, INTERVAL_MS } from '../lib/hyperliquid/index.ts';
import type { CandleInterval, CandleSet } from '../lib/types.ts';
import { fmtPx, fmtTime } from '../lib/format.ts';

const TIMEFRAMES: CandleInterval[] = ['1h', '15m', '5m'];

function windowFor(interval: CandleInterval, now: number): { start: number; end: number } {
  const ms = INTERVAL_MS[interval];
  const count = interval === '1h' ? 200 : 220;
  return { start: now - count * ms, end: now };
}

export default function SignalDetail() {
  const { coinId } = useParams<{ coinId: string }>();
  const coin = coinId ? decodeURIComponent(coinId) : '';
  const [timeframe, setTimeframe] = useState<CandleInterval>('15m');
  const [data, setData] = useState<CandleSet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!coin) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const now = Date.now();
    const { start, end } = windowFor(timeframe, now);
    fetchCandles(coin, timeframe, start, end, { now })
      .then((set) => {
        if (!cancelled) setData(set);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [coin, timeframe]);

  const lastClose = useMemo(
    () => (data && data.closed.length > 0 ? data.closed[data.closed.length - 1] : null),
    [data],
  );

  if (!coin) {
    return (
      <p className="text-sm text-mute">
        No market selected. Pick one from <Link to="/markets" className="underline">Stock Markets</Link>.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mono text-lg font-semibold">{coin}</h1>
        <span className="rounded bg-edge px-1.5 py-0.5 text-[11px] text-mute">NO_TRADE — engine Phase 4</span>
        <div className="ml-auto flex gap-1 text-xs">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              className={`mono rounded-md border px-2 py-1 ${tf === timeframe ? 'border-ink/40 bg-edge text-ink' : 'border-edge text-mute hover:text-ink'}`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <section className="rounded-lg border border-edge bg-panel p-3">
        {loading && <p className="p-6 text-center text-sm text-mute">Loading candles…</p>}
        {error && (
          <div className="p-4 text-sm">
            <p className="font-medium text-bear">Candle data unavailable (connection failure).</p>
            <p className="mono mt-1 text-xs text-mute">{error}</p>
            <p className="mt-1 text-xs text-mute">
              Missing data never produces a signal — this market stays NO_TRADE until fresh
              confirmed candles arrive.
            </p>
          </div>
        )}
        {data && !loading && !error && (
          <>
            {data.closed.length === 0 ? (
              <p className="p-6 text-center text-sm text-mute">
                No confirmed candles in this window (sparse after-hours trading is normal for
                equity perps). No signal can be computed from an empty series.
              </p>
            ) : (
              <CandleChart candles={data.closed} />
            )}
            <div className="mono mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mute">
              <span>confirmed closed: {data.closed.length}</span>
              <span>
                provisional: {data.provisional ? `${fmtPx(data.provisional.close)} (display only)` : 'none'}
              </span>
              <span>last close: {lastClose ? `${fmtPx(lastClose.close)} @ ${fmtTime(lastClose.time)}` : '—'}</span>
            </div>
          </>
        )}
      </section>

      <section className="rounded-lg border border-edge bg-panel p-4 text-sm">
        <h2 className="font-semibold">Setup diagnostics</h2>
        <p className="mt-1 text-mute">
          Signal state: <span className="mono text-ink">NO_TRADE</span> — the SMC setup engine
          (swings, BOS/CHoCH, liquidity sweeps, FVG, order blocks, entry/risk) is implemented and
          tested in Phase 4. Rejected-setup diagnostics will appear here rather than on the
          dashboard.
        </p>
      </section>
    </div>
  );
}
