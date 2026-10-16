/**
 * Confirmed swing highs and lows (fractal rule, causal).
 *
 * Rule: bar i is a swing high of strength k iff
 *   high[i] > high[j] for all j in [i-k, i) and (i, i+k],
 * using STRICT inequality (equal highs never confirm — they are liquidity).
 * A swing low mirrors with `<` on lows.
 *
 * Causality / no-repaint: a swing at bar i is only emitted once bar i+k has
 * CLOSED (`confirmedAt` = close time of bar i+k). Evaluating "as of" any
 * earlier timestamp excludes it. Equal prices on either side veto the swing.
 */
import type { Candle, SwingPoint } from '../types.ts';

/**
 * Detect confirmed swings over bars [0, asOfIndex] (inclusive).
 * Only swings with full k-bar confirmation inside the window are returned.
 */
export function findSwings(
  candles: Candle[],
  strength: number,
  asOfIndex?: number,
): SwingPoint[] {
  if (!Number.isInteger(strength) || strength < 1) {
    throw new Error('findSwings: strength must be an integer >= 1');
  }
  const end = asOfIndex ?? candles.length - 1;
  const swings: SwingPoint[] = [];
  for (let i = strength; i + strength <= end; i += 1) {
    const c = candles[i];
    if (!c) continue;
    let isHigh = true;
    let isLow = true;
    for (let j = i - strength; j <= i + strength; j += 1) {
      if (j === i) continue;
      const o = candles[j];
      if (!o) {
        isHigh = false;
        isLow = false;
        break;
      }
      if (o.high >= c.high) isHigh = false;
      if (o.low <= c.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    const confirmedAt = candles[i + strength]?.closeTime;
    if (confirmedAt == null) continue;
    if (isHigh) swings.push({ index: i, time: c.time, price: c.high, side: 'high', confirmedAt });
    else if (isLow) {
      swings.push({ index: i, time: c.time, price: c.low, side: 'low', confirmedAt });
    }
  }
  return swings;
}

/** Most recent swing of a given side at or before `asOfIndex`, if any. */
export function lastSwing(
  swings: SwingPoint[],
  side: 'high' | 'low',
  asOfIndex: number,
): SwingPoint | null {
  let out: SwingPoint | null = null;
  for (const s of swings) {
    if (s.side === side && s.index <= asOfIndex && (out == null || s.index > out.index)) out = s;
  }
  return out;
}
