import { useScanner } from '../hooks/useScanner.tsx';
import { persistenceStatus } from '../lib/supabase.ts';

export default function Settings() {
  const { settings, updateSettings, clearSignals, signals } = useScanner();
  const persist = persistenceStatus();

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-lg font-semibold">Settings</h1>

      <section className="rounded-lg border border-edge bg-panel p-4 text-sm">
        <h2 className="font-semibold">Scanning</h2>
        <div className="mt-2 grid gap-2">
          <label className="flex items-center justify-between gap-3 text-mute">
            Markets per scan (top by 24h notional)
            <input
              type="number"
              min={3}
              max={15}
              value={settings.topN}
              onChange={(e) => updateSettings({ topN: Number(e.target.value) })}
              className="mono w-20 rounded-md border border-edge bg-board px-2 py-1 text-ink"
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-mute">
            Minimum risk / reward
            <span className="flex items-center gap-1">
              <span className="mono">1 :</span>
              <input
                value={String(settings.minRiskReward)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) updateSettings({ minRiskReward: v });
                }}
                inputMode="decimal"
                className="mono w-16 rounded-md border border-edge bg-board px-2 py-1 text-ink"
                aria-label="Minimum risk reward ratio"
              />
            </span>
          </label>
        </div>
        <p className="mt-1 text-xs text-mute">Timeframes: 1h context · 15m setup · 5m entry.</p>
      </section>

      <section className="rounded-lg border border-edge bg-panel p-4 text-sm">
        <h2 className="font-semibold">Paper trading</h2>
        <div className="mt-2 grid gap-2">
          <label className="flex items-center justify-between gap-3 text-mute">
            Starting balance ($)
            <input
              type="number"
              min={100}
              value={settings.startingBalance}
              onChange={(e) => updateSettings({ startingBalance: Number(e.target.value) })}
              className="mono w-28 rounded-md border border-edge bg-board px-2 py-1 text-ink"
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-mute">
            Risk per trade (%)
            <input
              type="number"
              min={0.1}
              max={100}
              step={0.1}
              value={settings.riskPct}
              onChange={(e) => updateSettings({ riskPct: Number(e.target.value) })}
              className="mono w-20 rounded-md border border-edge bg-board px-2 py-1 text-ink"
            />
          </label>
        </div>
        <p className="mt-1 text-xs text-mute">
          Applies to newly created accounts (use Reset on the Paper page). Simulated only.
        </p>
      </section>

      <section className="rounded-lg border border-edge bg-panel p-4 text-sm">
        <h2 className="font-semibold">Secondary strategy</h2>
        <label className="mt-2 flex items-center justify-between gap-3 text-mute">
          Technical Confluence (comparison only)
          <button
            type="button"
            role="switch"
            aria-checked={settings.techEnabled}
            onClick={() => updateSettings({ techEnabled: !settings.techEnabled })}
            className={`mono rounded-md border px-2 py-1 text-xs ${settings.techEnabled ? 'border-bull/60 text-bull' : 'border-edge text-mute'}`}
          >
            {settings.techEnabled ? 'ON' : 'OFF (default)'}
          </button>
        </label>
        <p className="mt-1 text-xs text-mute">
          EMA 20/50/200 · RSI 14 · MACD · ATR · relative volume + HTF filter. Separate signals,
          history and metrics — never merged with SMC scores.
        </p>
      </section>

      <section className="rounded-lg border border-edge bg-panel p-4 text-sm">
        <h2 className="font-semibold">Data source</h2>
        <p className="mono mt-1 text-xs text-mute">
          {import.meta.env.VITE_HL_API_BASE || 'https://api.hyperliquid.xyz (default)'}
        </p>
        <p className="mt-1 text-xs text-mute">
          Override with <span className="mono">VITE_HL_API_BASE</span>.
        </p>
      </section>

      <section className="rounded-lg border border-edge bg-panel p-4 text-sm">
        <h2 className="font-semibold">Persistence & alerts</h2>
        <p className="mt-1 text-mute">
          {persist.configured ? 'Supabase keys present — cloud sync pending, local-only for now.' : 'Local-only (Supabase not configured).'}
        </p>
        <p className="mt-1 text-xs text-mute">
          Telegram alerts run server-side via scheduled scans when bot secrets are configured;
          the browser never holds credentials. {signals.length} signal(s) stored locally.
        </p>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Clear all stored signals? Paper history is kept.')) clearSignals();
          }}
          className="mt-2 rounded-md border border-edge px-2 py-1 text-xs text-mute hover:text-ink"
        >
          Clear stored signals
        </button>
      </section>
    </div>
  );
}
