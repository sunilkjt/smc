import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDiscovery } from '../hooks/useDiscovery.tsx';
import { useScanner } from '../hooks/useScanner.tsx';
import { dayChangePct, fmtCompact, fmtPct, fmtPx, timeAgo } from '../lib/format.ts';

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'live' ? 'bg-bull' : status === 'loading' || status === 'idle' ? 'bg-gold' : 'bg-bear';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

export default function Dashboard() {
  const { status, result, error, lastSuccessAt, refresh } = useDiscovery();
  const { signals, paper, progress, settings, runScan } = useScanner();
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<'all' | 'long' | 'short'>('all');
  const [minQuality, setMinQuality] = useState(0);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const tradable = useMemo(
    () =>
      signals.filter(
        (s) =>
          s.setup != null &&
          (s.state === 'WAITING_FOR_RETEST' || s.state === 'ACTIVE') &&
          (direction === 'all' || s.direction === direction) &&
          s.setup.qualityPassed >= minQuality &&
          (query.trim() === '' || s.coin.toLowerCase().includes(query.trim().toLowerCase())),
      ).sort(
        (a, b) =>
          (b.setup?.qualityPassed ?? 0) - (a.setup?.qualityPassed ?? 0) ||
          (b.setup?.riskReward1 ?? 0) - (a.setup?.riskReward1 ?? 0),
      ),
    [signals, direction, minQuality, query],
  );

  const diagnostics = useMemo(
    () => signals.filter((s) => s.state === 'NO_TRADE'),
    [signals],
  );

  const stale = lastSuccessAt != null && Date.now() - lastSuccessAt > 5 * 60_000;
  const activePositions = paper.openPositions.length;
  const closedCount = paper.closedTrades.length;
  const totalR = paper.closedTrades.reduce((a, t) => a + t.realizedR, 0);

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
          <h2 className="text-xs font-medium text-mute">Last signal scan</h2>
          <p className="mono mt-1 text-sm">
            {progress.lastScanAt ? new Date(progress.lastScanAt).toLocaleTimeString('en-GB') : 'never'}
          </p>
          <button
            type="button"
            onClick={runScan}
            disabled={progress.running || status !== 'live'}
            className="mt-1 rounded-md border border-edge px-2 py-0.5 text-xs text-mute hover:text-ink disabled:opacity-50"
          >
            {progress.running ? `Scanning ${progress.done}/${progress.total}…` : 'Run scan'}
          </button>
          {progress.error && <p className="mt-1 text-[11px] text-bear">{progress.error}</p>}
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
          <h2 className="text-xs font-medium text-mute">Paper trading</h2>
          <p className="mt-1 text-sm">
            {activePositions} open · {closedCount} closed
          </p>
          <p className={`mono mt-1 text-[11px] ${totalR >= 0 ? 'text-bull' : 'text-bear'}`}>
            {closedCount > 0 ? `total ${totalR >= 0 ? '+' : ''}${totalR.toFixed(2)}R` : 'simulated only'}
          </p>
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
            <label className="flex items-center gap-1 text-mute">
              Min quality
              <input
                type="number"
                min={0}
                max={8}
                value={minQuality}
                onChange={(e) => setMinQuality(Number(e.target.value))}
                className="mono w-12 rounded-md border border-edge bg-board px-1 py-1 text-xs"
              />
            </label>
          </div>
        </div>
        {tradable.length === 0 ? (
          <div className="mt-3 rounded-md border border-edge/70 bg-board p-4 text-sm text-mute">
            {signals.length === 0
              ? `No scan yet — press “Run scan” to evaluate the top ${settings.topN} liquid stocks across 1h context + 15m setup. Only fully-validated setups appear here.`
              : 'No validated setups match the filters. Weak or incomplete patterns stay NO_TRADE by design — quality over quantity.'}
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-edge/60 text-sm">
            {tradable.map((s) => {
              const setup = s.setup;
              if (!setup) return null;
              const up = s.direction === 'long';
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className={`mono text-xs font-semibold ${up ? 'text-bull' : 'text-bear'}`}>
                    {up ? 'BUY' : 'SELL'}
                  </span>
                  <Link to={`/signal/${encodeURIComponent(s.coin)}`} className="mono font-medium hover:underline">
                    {s.coin}
                  </Link>
                  <span className="mono text-[11px] text-mute">{s.setupTimeframe}</span>
                  <span className="mono text-xs">
                    {fmtPx(setup.entry)} → SL {fmtPx(setup.stopLoss)} → TP {fmtPx(setup.takeProfit1)}
                  </span>
                  <span className="mono text-xs text-mute">RR {setup.riskReward1.toFixed(2)}</span>
                  <span className="mono ml-auto text-[11px] text-mute">
                    {setup.qualityPassed}/{setup.qualityTotal} checks · {s.state}
                    {s.strategy === 'tech' ? ' · TECH' : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {diagnostics.length > 0 && (
          <button
            type="button"
            onClick={() => setShowDiagnostics((v) => !v)}
            className="mt-2 text-xs text-mute underline hover:text-ink"
          >
            {showDiagnostics ? 'Hide' : 'Show'} rejected diagnostics ({diagnostics.length})
          </button>
        )}
        {showDiagnostics && (
          <ul className="mono mt-2 space-y-1 text-[11px] text-mute">
            {diagnostics.slice(0, 20).map((s) => (
              <li key={s.id}>
                {s.coin} {s.direction}: {s.noTradeReason} — {s.note}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-edge bg-panel p-4">
        <h2 className="text-sm font-semibold">Most liquid verified stocks</h2>
        {status === 'loading' || status === 'idle' ? (
          <p className="mt-2 text-sm text-mute">Discovering markets…</p>
        ) : (result?.markets.length ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-mute">
            {result
              ? 'No markets meet the verification criteria right now.'
              : 'Market list unavailable — see the connection status above.'}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-edge/60 text-sm">
            {(result?.markets ?? []).slice(0, 8).map((m) => {
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
