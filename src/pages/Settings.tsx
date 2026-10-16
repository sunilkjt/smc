import { useState } from 'react';

const CONTEXT_TF = '1h';
const SETUP_TF = '15m';
const ENTRY_TF = '5m';

export default function Settings() {
  const [minRR, setMinRR] = useState('2');
  const apiBase = import.meta.env.VITE_HL_API_BASE || 'https://api.hyperliquid.xyz (default)';

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-lg font-semibold">Settings</h1>

      <section className="rounded-lg border border-edge bg-panel p-4 text-sm">
        <h2 className="font-semibold">Strategy timeframes</h2>
        <p className="mono mt-1 text-mute">
          Context {CONTEXT_TF} · Setup {SETUP_TF} · Entry {ENTRY_TF}
        </p>
        <p className="mt-1 text-xs text-mute">
          Fixed for now; configurable per market from Phase 4.
        </p>
      </section>

      <section className="rounded-lg border border-edge bg-panel p-4 text-sm">
        <h2 className="font-semibold">Minimum risk / reward</h2>
        <div className="mt-2 flex items-center gap-2">
          <span className="mono text-mute">1 :</span>
          <input
            value={minRR}
            onChange={(e) => setMinRR(e.target.value)}
            inputMode="decimal"
            className="mono w-16 rounded-md border border-edge bg-board px-2 py-1"
            aria-label="Minimum risk reward ratio"
          />
        </div>
        <p className="mt-1 text-xs text-mute">
          Baseline 1:2. Enforced by the setup engine from Phase 4.
        </p>
      </section>

      <section className="rounded-lg border border-edge bg-panel p-4 text-sm">
        <h2 className="font-semibold">Data source</h2>
        <p className="mono mt-1 text-xs text-mute">{apiBase}</p>
        <p className="mt-1 text-xs text-mute">
          Override with the <span className="mono">VITE_HL_API_BASE</span> environment variable.
        </p>
      </section>

      <section className="rounded-lg border border-edge bg-panel p-4 text-sm">
        <h2 className="font-semibold">Persistence</h2>
        <p className="mt-1 text-mute">
          Local-only for now. Supabase history sync is optional (Phase 7) and shown as unavailable
          until configured — never pretended.
        </p>
      </section>

      <section className="rounded-lg border border-edge bg-panel p-4 text-sm">
        <h2 className="font-semibold">Secondary strategy</h2>
        <p className="mt-1 text-mute">
          Technical Confluence (EMA/RSI/MACD/ATR/volume) is disabled by default and arrives in
          Phase 6 with separate signals, history and metrics.
        </p>
      </section>
    </div>
  );
}
