/**
 * Signal lifecycle: forward-only state transitions over confirmed candles.
 *
 * States and transitions (all evaluated on CLOSED candles, causal):
 * - WAITING_FOR_RETEST → ACTIVE: a candle's range strictly penetrates the
 *   limit entry (long: low < entry; touching is NOT a fill). A violent bar
 *   that fills and then reaches the stop in the same candle resolves
 *   immediately as RESOLVED/STOP (stop-first). Note there is deliberately NO
 *   "stop breached before fill" path: any close beyond the stop necessarily
 *   traded through the entry first (entry sits between price and stop), so
 *   the fill-then-stop path always applies — no silent exception.
 * - WAITING_FOR_RETEST → INVALIDATED: price runs beyond TP1 before filling
 *   (entry missed; chasing forbidden).
 * - WAITING_FOR_RETEST → EXPIRED: `signalExpiryBars` setup-TF bars pass after
 *   the signal bar with no fill.
 * - ACTIVE → RESOLVED: stop-first resolution per bar — if a bar's range
 *   reaches BOTH stop and target and intrabar order is unknowable, the STOP
 *   wins (documented pessimism). TP1 hit resolves as 'TP1'; TP2 as 'TP2'.
 * - Terminal states (INVALIDATED, EXPIRED, RESOLVED) never transition again.
 * - NO_TRADE signals carry diagnostics only and never transition.
 *
 * All functions are pure: (signal, candles, config) → new signal. History is
 * preserved by callers (store appends lifecycle events via updatedAt).
 */
import type { Candle, EngineConfig, Signal, SignalState } from '../types.ts';

export interface ForwardWindow {
  /** Confirmed candles AFTER the signal bar, ascending. */
  candles: Candle[];
  /** Setup-TF bar length in ms (for expiry counting). */
  barMs: number;
}

function touchedStrict(candle: Candle, price: number, side: 'long' | 'short'): boolean {
  // Strict penetration: a mere touch of the limit price never fills.
  return side === 'long' ? candle.low < price : candle.high > price;
}

/**
 * Advance one signal across forward candles. Returns the (possibly new)
 * signal; the input is never mutated.
 */
export function advanceSignal(signal: Signal, window: ForwardWindow, config: EngineConfig): Signal {
  if (
    signal.state === 'RESOLVED' ||
    signal.state === 'INVALIDATED' ||
    signal.state === 'EXPIRED' ||
    signal.state === 'NO_TRADE' ||
    signal.setup == null
  ) {
    return signal;
  }
  const setup = signal.setup;
  const dir = setup.direction;
  let state: SignalState = signal.state;
  let entryFilledAt = signal.entryFilledAt;
  let resolvedAt = signal.resolvedAt;
  let resolution = signal.resolution;
  let updatedAt = signal.updatedAt;

  const touch = (n: number): void => {
    updatedAt = Math.max(updatedAt, n);
  };

  for (let k = 0; k < window.candles.length; k += 1) {
    const bar = window.candles[k];
    if (!bar || bar.closeTime <= setup.signalTime) continue;
    if (state === 'WAITING_FOR_RETEST') {
      const barsSince = k + 1;
      const filled = touchedStrict(bar, setup.entry, dir);
      const ranAway = dir === 'long' ? bar.close > setup.takeProfit1 : bar.close < setup.takeProfit1;
      if (filled) {
        state = 'ACTIVE';
        entryFilledAt = bar.closeTime;
        touch(bar.closeTime);
        // Continue scanning the SAME bar for an immediate stop-out: a
        // violent bar can fill then stop within one candle (stop-first).
        const stopHit =
          dir === 'long' ? bar.low < setup.stopLoss : bar.high > setup.stopLoss;
        if (stopHit) {
          state = 'RESOLVED';
          resolvedAt = bar.closeTime;
          resolution = 'STOP (same-bar stop-first)';
          touch(bar.closeTime);
          break;
        }
        continue;
      }
      if (ranAway) {
        state = 'INVALIDATED';
        resolvedAt = bar.closeTime;
        resolution = 'price ran beyond TP1 before fill (missed, no chase)';
        touch(bar.closeTime);
        break;
      }
      if (barsSince > config.signalExpiryBars) {
        state = 'EXPIRED';
        resolvedAt = bar.closeTime;
        resolution = `no fill within ${config.signalExpiryBars} bars`;
        touch(bar.closeTime);
        break;
      }
    } else if (state === 'ACTIVE') {
      const stopHit =
        dir === 'long' ? bar.low < setup.stopLoss : bar.high > setup.stopLoss;
      const tp1Hit =
        dir === 'long' ? bar.high > setup.takeProfit1 : bar.low < setup.takeProfit1;
      const tp2Hit =
        dir === 'long' ? bar.high > setup.takeProfit2 : bar.low < setup.takeProfit2;
      // Stop-first: unknowable intrabar order resolves against the trader.
      if (stopHit) {
        state = 'RESOLVED';
        resolvedAt = bar.closeTime;
        resolution = 'STOP';
      } else if (tp2Hit) {
        state = 'RESOLVED';
        resolvedAt = bar.closeTime;
        resolution = 'TP2';
      } else if (tp1Hit) {
        state = 'RESOLVED';
        resolvedAt = bar.closeTime;
        resolution = 'TP1';
      } else {
        continue;
      }
      touch(bar.closeTime);
      break;
    }
  }

  if (state === signal.state) return signal;
  return { ...signal, state, entryFilledAt, resolvedAt, resolution, updatedAt };
}
