import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import CandleChart, { type ChartLine } from '../components/CandleChart.tsx';
import { fetchCandles, INTERVAL_MS } from '../lib/hyperliquid/index.ts';
import { buildSmcOverlays, type OverlaySelection } from '../lib/smc/overlays.ts';
import { useScanner } from '../hooks/useScanner.tsx';
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
  const { signals, paper } = useScanner();
  const [timeframe, setTimeframe] = useState<CandleInterval>('15m');
  const [data, setData] = useState<CandleSet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<OverlaySelection>({ structure: true, sweeps: true, zones: true });

  const coinSignals = useMemo(
    () => signals.filter((s) => s.coin === coin),
    [signals, coin],
  );
  const active = useMemo(
    () => coinSignals.find((s) => s.setup != null && (s.state === 'WAITING_FOR_RETEST' || s.state === 'ACTIVE')) ?? null,
    [coinSignals],
  );
  const position = useMemo(
    () =>
      paper.openPositions.find((p) => active && p.signalId === active.id) ??
      paper.closedTrades.find((p) => active && p.signalId === active.id) ??
      null,
    [paper, active],
  );

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

  const lines: ChartLine[] = useMemo(() => {
    const base: ChartLine[] = [];
    if (active?.setup) {
      const s = active.setup;
      base.push(
        { price: s.entry, color: '#d9a441', title: 'ENTRY' },
        { price: s.stopLoss, color: '#e5484d', title: 'SL', dashed: true },
        { price: s.takeProfit1, color: '#22c07a', title: 'TP1' },
        { price: s.takeProfit2, color: '#22c07a', title: 'TP2', dashed: true },
      );
    }
    if (data && overlays.zones) {
      for (const z of buildSmcOverlays(data.closed, overlays).zones) {
        base.push({ price: z.top, color: z.color, title: z.title, dashed: true });
        base.push({ price: z.bottom, color: z.color, title: z.title, dashed: true });
      }
    }
    return base;
  }, [active, data, overlays]);

  const markers = useMemo(
    () => (data ? buildSmcOverlays(data.closed, overlays).markers : []),
    [data, overlays],
  );

  const stale = useMemo(() => {
    if (!lastClose) return false;
    return Date.now() - lastClose.closeTime > 2 * INTERVAL_MS[timeframe];
  }, [lastClose, timeframe]);

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
        <span className="rounded bg-edge px-1.5 py-0.5 text-[11px] text-mute">
          {active ? `${active.direction.toUpperCase()} · ${active.state}` : 'NO_TRADE'}
        </span>
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
              <>
                <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-mute">
                  <span className="font-medium text-ink">Overlays:</span>
                  {(['structure', 'sweeps', 'zones'] as const).map((key) => (
                    <label key={key} className="flex cursor-pointer items-center gap-1 hover:text-ink">
                      <input
                        type="checkbox"
                        checked={overlays[key]}
                        onChange={() => setOverlays((o) => ({ ...o, [key]: !o[key] }))}
                        className="accent-[#22c07a]"
                      />
                      {key === 'structure' ? 'BOS/CHoCH' : key === 'sweeps' ? 'Sweeps' : 'FVG/OB zones'}
                    </label>
                  ))}
                  {stale && (
                    <span className="ml-auto rounded bg-gold/15 px-1.5 py-0.5 text-gold">
                      Stale: last confirmed candle is old — no new signals until fresh data arrives.
                    </span>
                  )}
                </div>
                <CandleChart candles={data.closed} lines={lines} markers={markers} />
              </>
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

      {active?.setup ? (
        <section className="rounded-lg border border-edge bg-panel p-4 text-sm">
          <h2 className="font-semibold">
            {active.direction === 'long' ? 'BUY' : 'SELL'} setup · {active.setup.setupTimeframe} · RR{' '}
            {active.setup.riskReward1.toFixed(2)}
          </h2>
          <div className="mono mt-2 grid gap-1 text-xs sm:grid-cols-2">
            <span>Entry zone: {fmtPx(active.setup.entryZoneBottom)} – {fmtPx(active.setup.entryZoneTop)}</span>
            <span>Limit entry: {fmtPx(active.setup.entry)}</span>
            <span className="text-bear">Stop: {fmtPx(active.setup.stopLoss)}</span>
            <span className="text-bull">TP1 {fmtPx(active.setup.takeProfit1)} · TP2 {fmtPx(active.setup.takeProfit2)}</span>
          </div>
          <p className="mt-2 text-mute">{active.setup.explanation}</p>
          <h3 className="mt-3 font-medium">Conditions (transparent checklist, not a confidence %)</h3>
          <ul className="mono mt-1 space-y-0.5 text-[11px]">
            {active.setup.conditions.map((c) => (
              <li key={c.name} className={c.passed ? 'text-bull' : 'text-bear'}>
                [{c.passed ? '+' : '×'}] {c.name}: {c.detail}
              </li>
            ))}
          </ul>
          {position && (
            <p className="mono mt-2 text-[11px] text-mute">
              Paper: {position.status} · size {position.size.toFixed(4)} · risk ${position.riskAmount.toFixed(2)}
              {position.realizedR != null ? ` · R ${position.realizedR >= 0 ? '+' : ''}${position.realizedR.toFixed(2)}` : ''}
              {active.resolution ? ` · signal ${active.resolution}` : ''}
            </p>
          )}
        </section>
      ) : (
        <section className="rounded-lg border border-edge bg-panel p-4 text-sm">
          <h2 className="font-semibold">Setup diagnostics</h2>
          {coinSignals.length === 0 ? (
            <p className="mt-1 text-mute">
              No evaluation yet — run a scan from the Dashboard. Rejected-setup diagnostics appear
              here rather than cluttering the main view.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {coinSignals.map((s) => (
                <li key={s.id} className="rounded border border-edge/70 bg-board p-2 text-xs">
                  <span className="mono font-medium">{s.direction.toUpperCase()}</span>{' '}
                  <span className="mono text-mute">{s.state}</span>
                  {s.noTradeReason && (
                    <span className="mono text-gold"> · {s.noTradeReason}</span>
                  )}
                  {s.note && <p className="mt-1 text-mute">{s.note}</p>}
                  {s.setup && <p className="mt-1 text-mute">{s.setup.explanation}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
