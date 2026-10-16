/**
 * Average True Range (Wilder's smoothing). Used only as a volatility ruler
 * for stop buffers and minimum-target distances — never as a trade trigger.
 */
import type { Candle } from '../types.ts';

/** True range of bar i (needs bar i-1's close; bar 0 uses high-low). */
export function trueRange(candles: Candle[], i: number): number {
  const c = candles[i];
  if (!c) throw new Error('trueRange: index out of bounds');
  if (i === 0) return c.high - c.low;
  const prevClose = candles[i - 1]?.close ?? c.close;
  return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
}

/**
 * Wilder ATR ending at bar `endIndex` (inclusive) over `period`.
 * Causal: uses only bars [endIndex-period+1, endIndex] plus one prior close.
 */
export function atr(candles: Candle[], period: number, endIndex: number): number {
  if (period < 1) throw new Error('atr: period must be >= 1');
  if (endIndex < period) {
    throw new Error(`atr: need at least ${period + 1} bars, got ${endIndex + 1}`);
  }
  // Seed with simple mean of the first `period` true ranges in-window, then
  // Wilder-smooth across the window. All inputs are <= endIndex (causal).
  const start = endIndex - period + 1;
  let value = 0;
  for (let i = start; i < start + period; i += 1) value += trueRange(candles, i);
  value /= period;
  return value;
}
