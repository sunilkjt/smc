/**
 * Fair Value Gaps (three-candle rule) with open/partial/filled/invalidated
 * tracking — causal, no look-ahead.
 *
 * Rule:
 * - Bullish FVG at bar i (i >= 2): low[i] > high[i-2] (strict gap between the
 *   first candle's high and the third candle's low, middle candle displaced).
 *   Zone = [high[i-2], low[i]]. Bearish mirrors: high[i] < low[i-2], zone =
 *   [high[i], low[i-2]].
 * - Status evolves over LATER bars only (j > createdIndex):
 *     open    — no subsequent wick has entered the zone.
 *     partial — a wick entered the zone but no close crossed the far side.
 *     filled  — a close printed back through the far side (bullish gap
 *               filled when close[j] < bottom: acceptance below the gap).
 *
 * Documented simplification: mitigation is measured against the zone only.
 *   bullish: partial when low[j] < top (wick dips into the zone);
 *            filled when close[j] < bottom (acceptance back through);
 *            invalidated when close[j] > high[createdIndex] (a later close
 *            beyond the displacement candle's high: the market drove through
 *            the origin extreme, so the zone is no longer a valid
 *            retracement target).
 *   bearish mirrors with high/close comparisons against low[createdIndex].
 * A gap that fills is spent and never reused as an entry zone.
 * Only information available at each bar's close is used.
 */
import type { Candle, FairValueGap } from '../types.ts';

/** Detect raw gaps; statuses resolve against bars up to `asOfIndex`. */
export function detectFvgs(
  candles: Candle[],
  asOfIndex: number,
  lookback?: number,
): FairValueGap[] {
  const start = lookback == null ? 2 : Math.max(2, asOfIndex - lookback + 1);
  const gaps: FairValueGap[] = [];
  for (let i = start; i <= asOfIndex; i += 1) {
    const first = candles[i - 2];
    const third = candles[i];
    if (!first || !third) continue;
    if (third.low > first.high) {
      gaps.push({
        direction: 'bullish',
        top: third.low,
        bottom: first.high,
        createdIndex: i,
        createdTime: third.time,
        status: 'open',
        resolvedIndex: null,
      });
    } else if (third.high < first.low) {
      gaps.push({
        direction: 'bearish',
        top: first.low,
        bottom: third.high,
        createdIndex: i,
        createdTime: third.time,
        status: 'open',
        resolvedIndex: null,
      });
    }
  }
  for (const gap of gaps) resolveFvg(candles, gap, asOfIndex);
  return gaps;
}

/** Advance one gap's status using bars (createdIndex, asOfIndex]. Mutates. */
export function resolveFvg(candles: Candle[], gap: FairValueGap, asOfIndex: number): void {
  const origin = candles[gap.createdIndex];
  for (let j = gap.createdIndex + 1; j <= asOfIndex; j += 1) {
    const bar = candles[j];
    if (!bar) continue;
    if (gap.direction === 'bullish') {
      if (bar.close < gap.bottom) {
        gap.status = 'filled';
        gap.resolvedIndex = j;
        return;
      }
      if (origin && bar.close > origin.high) {
        gap.status = 'invalidated';
        gap.resolvedIndex = j;
        return;
      }
      if (bar.low < gap.top && gap.status === 'open') {
        gap.status = 'partial';
        gap.resolvedIndex = j;
      }
    } else {
      if (bar.close > gap.top) {
        gap.status = 'filled';
        gap.resolvedIndex = j;
        return;
      }
      if (origin && bar.close < origin.low) {
        gap.status = 'invalidated';
        gap.resolvedIndex = j;
        return;
      }
      if (bar.high > gap.bottom && gap.status === 'open') {
        gap.status = 'partial';
        gap.resolvedIndex = j;
      }
    }
  }
}

/**
 * Gaps usable as entry zones: created within `maxAgeBars` of `asOfIndex`,
 * still open or partially filled, and on the expected side of price for the
 * direction (bullish gap must sit at or below the evaluation close so the
 * entry is a retracement, not a chase).
 */
export function alignedEntryGaps(
  gaps: FairValueGap[],
  direction: 'bullish' | 'bearish',
  refPrice: number,
  asOfIndex: number,
  maxAgeBars: number,
): FairValueGap[] {
  return gaps.filter((g) => {
    if (direction === 'bullish' ? g.direction !== 'bullish' : g.direction !== 'bearish') {
      return false;
    }
    if (g.status !== 'open' && g.status !== 'partial') return false;
    if (asOfIndex - g.createdIndex > maxAgeBars) return false;
    return direction === 'bullish' ? g.top <= refPrice : g.bottom >= refPrice;
  });
}
