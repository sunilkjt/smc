/**
 * Order blocks: the last opposing-body candle before a qualifying structure
 * break. Reproducible, causal, and always tied to a specific break.
 *
 * Rule:
 * - For a bullish break at bar b (close[b] broke a swing high): scan back
 *   from b-1 for the most recent BEARISH-body candle (close < open) within
 *   `lookback` bars. That candle is the bullish order block; zone =
 *   [low, high] of that candle.
 * - Bearish mirrors (most recent bullish-body candle before a downside break).
 * - No opposing candle found within lookback → no order block (never label an
 *   arbitrary candle).
 * - Mitigation: a later wick enters the zone. Invalidation: a later CLOSE
 *   prints through the far side (bullish OB invalidated when close < bottom).
 * - Only bars after the break are used for mitigation checks (causal).
 */
import type { Candle, OrderBlock, StructureEvent } from '../types.ts';

/** Find the qualifying order block for one break event, if any. */
export function orderBlockForBreak(
  candles: Candle[],
  breakEvent: StructureEvent,
  lookback: number,
): OrderBlock | null {
  const bullish = breakEvent.type === 'BOS_BULL' || breakEvent.type === 'CHOCH_BULL';
  const b = breakEvent.index;
  for (let i = b - 1; i >= Math.max(0, b - lookback); i -= 1) {
    const c = candles[i];
    if (!c) continue;
    const opposing = bullish ? c.close < c.open : c.close > c.open;
    if (!opposing) continue;
    return {
      direction: bullish ? 'bullish' : 'bearish',
      top: c.high,
      bottom: c.low,
      index: i,
      createdTime: c.time,
      breakIndex: b,
      mitigated: false,
      invalidated: false,
    };
  }
  return null;
}

/** Advance mitigation/invalidation using bars (breakIndex, asOfIndex]. Mutates. */
export function resolveOrderBlock(
  candles: Candle[],
  block: OrderBlock,
  asOfIndex: number,
): void {
  for (let j = block.breakIndex + 1; j <= asOfIndex; j += 1) {
    const bar = candles[j];
    if (!bar) continue;
    if (block.direction === 'bullish') {
      if (bar.close < block.bottom) {
        block.invalidated = true;
        return;
      }
      if (bar.low <= block.top && bar.low >= block.bottom) block.mitigated = true;
      else if (bar.low < block.bottom && bar.close >= block.bottom) block.mitigated = true;
    } else {
      if (bar.close > block.top) {
        block.invalidated = true;
        return;
      }
      if (bar.high >= block.bottom && bar.high <= block.top) block.mitigated = true;
      else if (bar.high > block.top && bar.close <= block.top) block.mitigated = true;
    }
  }
}

/**
 * Blocks usable as entry zones: matching direction, not invalidated, created
 * within `maxAgeBars`, and positioned for a retracement (bullish block top at
 * or below the reference price).
 */
export function alignedEntryBlocks(
  blocks: OrderBlock[],
  direction: 'bullish' | 'bearish',
  refPrice: number,
  asOfIndex: number,
  maxAgeBars: number,
): OrderBlock[] {
  return blocks.filter((bl) => {
    if (bl.direction !== direction || bl.invalidated) return false;
    if (asOfIndex - bl.breakIndex > maxAgeBars) return false;
    return direction === 'bullish' ? bl.top <= refPrice : bl.bottom >= refPrice;
  });
}
