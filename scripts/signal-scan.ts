/**
 * Headless market scan CLI for scheduled runs (GitHub Actions) and debugging.
 * Thin wrapper over src/lib/headless-scan.ts (shared with the Telegram
 * command poller): prints a summary and writes machine-readable JSON.
 * Reads REAL public API data only. Exit 1 on failure (never empty success).
 *
 * Env: TOP_N (default 8, max 15), OUT (default scan-results.json),
 * TECH (1 = comparison strategy), MIN_RR (default 2), PERSIST (1 = Supabase
 * continuity; needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, otherwise runs
 * statelessly with a warning), PAPER_START / PAPER_RISK (first account only).
 *
 * Usage: npm run scan
 */
import { writeFileSync } from 'node:fs';
import { DEFAULT_ENGINE_CONFIG } from '../src/lib/types.ts';
import { runHeadlessScan } from '../src/lib/headless-scan.ts';
import type { SbConfig } from '../src/lib/supabase-sync.ts';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid ${name}=${raw}`);
  return n;
}

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${name}=${raw}`);
  return n;
}

async function main(): Promise<void> {
  const topN = envInt('TOP_N', 8);
  const out = process.env['OUT'] ?? 'scan-results.json';
  const techEnabled = process.env['TECH'] === '1';
  const minRR = Number(process.env['MIN_RR'] ?? DEFAULT_ENGINE_CONFIG.minRiskReward);
  const persist = process.env['PERSIST'] === '1';
  let sb: SbConfig | null = null;
  if (persist) {
    const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL'];
    const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
    if (url && key) {
      sb = { url, key };
    } else {
      // Missing secrets degrade to stateless, never fail the scheduled run.
      console.log('PERSIST=1 but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — running statelessly.');
    }
  }

  console.log(`Discovery + scan of top ${topN} verified stocks (tech=${techEnabled ? 'on' : 'off'}, persist=${sb ? 'supabase' : 'none'})`);
  const result = await runHeadlessScan({
    topN,
    techEnabled,
    minRR,
    sb,
    paperStart: envNum('PAPER_START', 10_000),
    paperRisk: envNum('PAPER_RISK', 1),
    onLog: (message) => console.log(message),
  });
  if (result.results.length === 0 && result.discovery.markets.length === 0) {
    console.log('EMPTY STATE: no verified stocks to scan.');
  }
  console.log(`Tradable SMC setups: ${result.tradableCount}`);
  const payload = {
    scannedAt: result.scannedAt,
    signals: result.results.flatMap((r) => r.scan.signals),
    markets: result.results.map((r) => ({ coin: r.coin, error: r.scan.error })),
  };
  writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${out}`);
}

main().catch((err: unknown) => {
  console.error(`SCAN FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
