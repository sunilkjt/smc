/**
 * Market structure: trend state, Break of Structure (BOS) and Change of
 * Character (CHoCH), dealing ranges with premium/discount zones.
 *
 * Rules (all evaluated on CLOSE prices, causal):
 * - bullish BOS: close[i] > lastSwingHigh.price while trend is bullish, and
 *   the broken swing was formed before i (no future data).
 * - bullish CHoCH: close[i] > lastSwingHigh.price while trend is bearish or
 *   neutral (first break against the prior trend flips it to bullish).
 * - Bearish mirrors with swing lows.
 * - After a break, the broken level becomes the new reference: the NEXT break
 *   compares against the most recent swing beyond the break bar.
 * - Dealing range: last confirmed swing high/low pair; equilibrium = mid.
 *   Price above equilibrium = premium (prefer shorts), below = discount
 *   (prefer longs). Informational context only — never a lone trigger.
 */
import type { Candle, DealingRange, StructureEvent, SwingPoint, TrendDirection } from '../types.ts';

export interface StructureState {
  trend: TrendDirection;
  events: StructureEvent[];
  lastHigh: SwingPoint | null;
  lastLow: SwingPoint | null;
}

/**
 * Walk closed candles [0, asOfIndex], tracking structure against `swings`.
 * Deterministic replay: identical inputs always yield identical states.
 */
export function analyzeStructure(
  candles: Candle[],
  swings: SwingPoint[],
  asOfIndex: number,
): StructureState {
  const events: StructureEvent[] = [];
  let trend: TrendDirection = 'neutral';
  let refHigh: SwingPoint | null = null;
  let refLow: SwingPoint | null = null;

  // Causal absorption: a swing becomes known exactly when its confirmation
  // bar closes. Walk bars in order, absorbing every swing whose confirmation
  // has passed before evaluating breaks on that bar.
  const pending = swings
    .filter((s) => s.index <= asOfIndex)
    .sort((a, b) => a.index - b.index);
  let cursor = 0;

  for (let i = 0; i <= asOfIndex; i += 1) {
    const bar = candles[i];
    if (!bar) continue;
    while (cursor < pending.length) {
      const s = pending[cursor];
      if (!s || s.index > i || s.confirmedAt > bar.closeTime) break;
      if (s.side === 'high') {
        if (!refHigh || s.index > refHigh.index) refHigh = s;
      } else if (!refLow || s.index > refLow.index) refLow = s;
      cursor += 1;
    }
    if (refHigh && bar.close > refHigh.price && refHigh.index < i) {
      const type = trend === 'bullish' ? 'BOS_BULL' : 'CHOCH_BULL';
      events.push({ type, index: i, time: bar.time, level: refHigh.price, close: bar.close });
      trend = 'bullish';
      refHigh = null; // consumed; next break needs a newer swing high
    } else if (refLow && bar.close < refLow.price && refLow.index < i) {
      const type = trend === 'bearish' ? 'BOS_BEAR' : 'CHOCH_BEAR';
      events.push({ type, index: i, time: bar.time, level: refLow.price, close: bar.close });
      trend = 'bearish';
      refLow = null;
    }
  }

  return { trend, events, lastHigh: refHigh, lastLow: refLow };
}

/** Dealing range from the latest confirmed swing pair (or null if absent).
 *  Callers must pass swings confirmed as of the evaluation bar (causal). */
export function dealingRange(swings: SwingPoint[], asOfIndex: number): DealingRange | null {
  let high: SwingPoint | null = null;
  let low: SwingPoint | null = null;
  for (const s of swings) {
    if (s.index > asOfIndex) continue;
    if (s.side === 'high' && (!high || s.index > high.index)) high = s;
    if (s.side === 'low' && (!low || s.index > low.index)) low = s;
  }
  if (!high || !low) return null;
  return { high: high.price, low: low.price, equilibrium: (high.price + low.price) / 2 };
}

/** Zone of a price inside a dealing range (informational context). */
export function premiumDiscount(
  range: DealingRange,
  price: number,
): 'premium' | 'discount' | 'equilibrium' {
  const band = (range.high - range.low) * 0.05;
  if (price > range.equilibrium + band) return 'premium';
  if (price < range.equilibrium - band) return 'discount';
  return 'equilibrium';
}
