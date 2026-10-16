/**
 * Read-only paper-trade audit. Recomputes every closed trade's outcome from
 * its stored record and reports mismatches — it NEVER writes, deletes, or
 * "fixes" history. A failing check means the stored record is inconsistent
 * and must be investigated, not silently repaired.
 *
 * Checks per closed trade:
 * - realizedR equals realizedPnl / riskAmount (tolerance 1e-6).
 * - Exit reason matches exit-price geometry: STOP exits sit on/through the
 *   stop side; TP1/TP2 exits sit at/through their target (0.5% tolerance for
 *   slippage + float noise). Anything else (e.g. a TP exit recorded below
 *   entry) FAILs.
 * - size, riskAmount > 0; fees >= 0; ids unique.
 * Checks per open trade: levels sane (stop/entry/targets ordered correctly).
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (read path only).
 * Without them it prints SKIP and exits 0 (verification impossible, not failed).
 *
 * Usage: npm run verify:paper
 */
import { loadTrades, type SbConfig } from '../src/lib/supabase-sync.ts';
import type { PaperPosition } from '../src/lib/types.ts';

const R_TOL = 1e-6;
const PX_TOL = 0.005;

let failures = 0;

function fail(tradeId: string, message: string): void {
  failures += 1;
  console.log(`FAIL ${tradeId}: ${message}`);
}

function checkClosed(t: PaperPosition): void {
  if (t.realizedPnl == null || t.realizedR == null || t.exitPrice == null) {
    fail(t.id, 'closed trade missing exit fields');
    return;
  }
  if (!(t.size > 0) || !(t.riskAmount > 0)) {
    fail(t.id, `non-positive size (${t.size}) or risk (${t.riskAmount})`);
  }
  if (!(t.fees >= 0)) fail(t.id, `negative fees (${t.fees})`);
  const expectedR = t.realizedPnl / t.riskAmount;
  if (Math.abs(expectedR - t.realizedR) > R_TOL) {
    fail(t.id, `R mismatch: stored ${t.realizedR}, recomputed ${expectedR}`);
  }
  const long = t.direction === 'long';
  const within = (px: number, ref: number): boolean =>
    Math.abs(px - ref) / Math.max(1e-9, Math.abs(ref)) <= PX_TOL;
  if (t.exitReason === 'STOP') {
    const ok = long ? t.exitPrice <= t.stopLoss * (1 + PX_TOL) : t.exitPrice >= t.stopLoss * (1 - PX_TOL);
    if (!ok) fail(t.id, `STOP exit ${t.exitPrice} not on stop side of ${t.stopLoss}`);
  } else if (t.exitReason === 'TP1' || t.exitReason === 'TP2') {
    const target = t.exitReason === 'TP1' ? t.takeProfit1 : t.takeProfit2;
    const reached = long ? t.exitPrice >= target * (1 - PX_TOL) : t.exitPrice <= target * (1 + PX_TOL);
    const exact = within(t.exitPrice, target);
    if (!reached && !exact) fail(t.id, `${t.exitReason} exit ${t.exitPrice} not at target ${target}`);
    // A "profit target" exit below/above entry respectively is impossible.
    if (long ? t.exitPrice < t.entry && !within(t.exitPrice, t.entry) : t.exitPrice > t.entry && !within(t.exitPrice, t.entry)) {
      // Partial-TP1 + stopped-runner blends can net negative overall while
      // the final leg is a stop — but then the reason must be STOP, not TP.
      fail(t.id, `${t.exitReason} exit ${t.exitPrice} on the wrong side of entry ${t.entry}`);
    }
  } else {
    fail(t.id, `unexpected exit reason ${String(t.exitReason)}`);
  }
}

function checkOpen(t: PaperPosition): void {
  if (!(t.size > 0) || !(t.riskAmount > 0)) {
    fail(t.id, 'open position has non-positive size or risk');
    return;
  }
  const long = t.direction === 'long';
  const ordered = long
    ? t.stopLoss < t.entry && t.entry < t.takeProfit1 && t.takeProfit1 < t.takeProfit2
    : t.stopLoss > t.entry && t.entry > t.takeProfit1 && t.takeProfit1 > t.takeProfit2;
  if (!ordered) fail(t.id, 'open position levels misordered (SL/entry/TP1/TP2)');
}

async function main(): Promise<void> {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    console.log('SKIP: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (nothing to verify against).');
    return;
  }
  const cfg: SbConfig = { url, key };
  const { open, closed, skipped } = await loadTrades(cfg);
  console.log(`loaded ${open.length} open, ${closed.length} closed (skipped ${skipped} corrupt rows)`);
  const seen = new Set<string>();
  for (const t of [...open, ...closed]) {
    if (seen.has(t.id)) fail(t.id, 'duplicate trade id');
    seen.add(t.id);
  }
  for (const t of closed) checkClosed(t);
  for (const t of open) checkOpen(t);
  if (failures > 0) {
    console.error(`VERIFY FAILED: ${failures} check(s) failed. History left untouched — investigate.`);
    process.exitCode = 1;
    return;
  }
  console.log(`VERIFY PASSED: ${closed.length} closed + ${open.length} open consistent.`);
}

main().catch((err: unknown) => {
  console.error(`VERIFY ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
