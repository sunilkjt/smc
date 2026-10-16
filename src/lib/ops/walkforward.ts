/**
 * Walk-forward / out-of-sample replay core (pure, tested).
 *
 * Design (frozen, documented — tuning parameters here is out of scope):
 * - Engine config is passed through untouched; callers use the production
 *   DEFAULT_ENGINE_CONFIG. No optimization loop exists by construction.
 * - Cutoffs are fixed calendar steps; each cutoff evaluates ONLY bars with
 *   closeTime <= cutoff (evaluation window = last 260 setup bars + last 130
 *   context bars, mirroring live fetch depth).
 * - Forward resolution uses bars AFTER the cutoff (capped), with the exact
 *   live fill/cost machinery (advanceSignal + openFromSignal +
 *   resolvePositions): same strict-penetration fills, stop-first ambiguity,
 *   fees and slippage as production. R is balance-invariant, so per-cutoff
 *   temp accounts aggregate safely.
 * - Determinism: identical inputs → identical outcomes (replay has no clocks
 *   except the caller-supplied scannedAt used for record-keeping).
 */
import { createAccount, openFromSignal, resolvePositions } from '../paper/engine.ts';
import { DEFAULT_ENGINE_CONFIG, type Candle, type ClosedTrade, type EngineConfig, type NoTradeReason, type Signal } from '../types.ts';
import { ingestScan, scanDirections } from '../signals/engine.ts';
import { advanceSignal } from '../signals/lifecycle.ts';

export const WF_SETUP_BARS = 260;
export const WF_CONTEXT_BARS = 130;
export const WF_FORWARD_BARS = 500;

/** Bars with closeTime <= cutoff, ascending (causal evaluation slice). */
export function sliceAtOrBefore(candles: Candle[], cutoff: number): Candle[] {
  return candles.filter((c) => c.closeTime <= cutoff);
}

/**
 * Fixed cutoff grid: `count` cutoffs ending at (not after) `spanEnd`,
 * spaced `stepMs` apart. Fixed windows — never fitted to results.
 */
export function buildCutoffs(spanEnd: number, stepMs: number, count: number): number[] {
  if (count < 1) throw new Error('buildCutoffs: count must be >= 1');
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i -= 1) out.push(spanEnd - i * stepMs);
  return out;
}

export interface CutoffOutcome {
  cutoff: number;
  /** Tradable (non-diagnostic) signals evaluated at this cutoff. */
  setups: number;
  /** First-failure reasons of the diagnostic signals (explains empty windows). */
  reasons: NoTradeReason[];
  /** Signals that filled within the forward window. */
  filled: number;
  /** Closed paper trades produced within the forward window. */
  trades: ClosedTrade[];
  /** Positions still open at the forward cap (unresolved, kept open). */
  openLeft: number;
}

/**
 * Replay one cutoff: evaluate frozen engine on the causal slice, then
 * forward-resolve with live accounting. Returns outcome; never mutates inputs.
 */
export function replayCutoff(
  coin: string,
  setupFull: Candle[],
  contextFull: Candle[],
  cutoff: number,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
  scannedAt = 0,
): CutoffOutcome {
  const evalSetup = sliceAtOrBefore(setupFull, cutoff).slice(-WF_SETUP_BARS);
  const evalContext = sliceAtOrBefore(contextFull, cutoff).slice(-WF_CONTEXT_BARS);
  const forward = setupFull
    .filter((c) => c.closeTime > cutoff)
    .slice(0, WF_FORWARD_BARS);
  if (evalSetup.length < config.structureLookback + 10 || evalContext.length < 30) {
    return { cutoff, setups: 0, reasons: ['STALE_OR_MISSING_DATA'], filled: 0, trades: [], openLeft: 0 };
  }
  const fresh = scanDirections({ coin, context: evalContext, setup: evalSetup, config, dataNow: cutoff, scannedAt });
  const reasons = fresh
    .filter((s) => s.state === 'NO_TRADE' && s.noTradeReason != null)
    .map((s) => s.noTradeReason as NoTradeReason);
  const signals = ingestScan([], fresh);
  let filled = 0;
  let account = createAccount();
  const barMs = evalSetup.length > 1 && evalSetup[0] && evalSetup[1]
    ? evalSetup[1].time - evalSetup[0].time
    : 900_000;
  const advanced: Signal[] = signals.map((s) => {
    if (s.setup == null) return s;
    const next = advanceSignal(s, { candles: forward, barMs }, config);
    if (next.state === 'ACTIVE' || next.state === 'RESOLVED') filled += 1;
    return next;
  });
  for (const s of advanced) {
    if (s.state !== 'ACTIVE' && s.state !== 'RESOLVED') continue;
    // Positions open only on confirmed fills; resolution replays the same
    // forward window the lifecycle used (conservative, documented).
    const res = openFromSignal(account, s.state === 'ACTIVE' ? s : { ...s, state: 'ACTIVE' as const }, s.entryFilledAt ?? cutoff);
    account = res.account;
  }
  account = resolvePositions(account, forward);
  return {
    cutoff,
    setups: signals.filter((s) => s.setup != null).length,
    reasons,
    filled,
    trades: [...account.closedTrades],
    openLeft: account.openPositions.length,
  };
}
