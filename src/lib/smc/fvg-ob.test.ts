import { describe, expect, it } from 'vitest';
import { alignedEntryGaps, detectFvgs } from './fvg.ts';
import { alignedEntryBlocks, orderBlockForBreak, resolveOrderBlock } from './orderblocks.ts';
import type { StructureEvent } from '../types.ts';
import { mkCandles } from './smc-core.test.ts';

describe('detectFvgs', () => {
  it('detects a bullish gap with the three-candle rule', () => {
    const bars = mkCandles([
      [10, 11, 9.5, 10.5],
      [10.5, 12, 10.4, 11.8],
      [11.8, 13, 11.5, 12.5], // low 11.5 > high[0] 11 → gap [11, 11.5]
      [12.5, 12.8, 12, 12.2],
    ]);
    const gaps = detectFvgs(bars, bars.length - 1);
    expect(gaps.length).toBe(1);
    expect(gaps[0]).toMatchObject({ direction: 'bullish', top: 11.5, bottom: 11 });
  });

  it('requires a strict gap (touching edges are not a gap)', () => {
    const bars = mkCandles([
      [10, 11, 9.5, 10.5],
      [10.5, 12, 10.4, 11.8],
      [11.8, 13, 11, 12.5], // low == high[0] → no gap
    ]);
    expect(detectFvgs(bars, bars.length - 1)).toEqual([]);
  });

  it('tracks partial then filled, and invalidates beyond the origin extreme', () => {
    const bars = mkCandles([
      [10, 11, 9.5, 10.5],
      [10.5, 12, 10.4, 11.8],
      [11.8, 13, 11.5, 12.5], // gap [11, 11.5], origin high 13
      [12.5, 12.6, 11.2, 12], // wick 11.2 < 11.5 → partial
      [12, 12.1, 10, 10.5], // close 10.5 < 11 → filled
    ]);
    const mid = detectFvgs(bars, 3);
    expect(mid[0]?.status).toBe('partial');
    const done = detectFvgs(bars, 4);
    expect(done[0]?.status).toBe('filled');

    const invalid = mkCandles([
      [10, 11, 9.5, 10.5],
      [10.5, 12, 10.4, 11.8],
      [11.8, 13, 11.5, 12.5],
      [12.5, 14, 12.4, 13.5], // close 13.5 > origin high 13 → invalidated
    ]);
    expect(detectFvgs(invalid, 3)[0]?.status).toBe('invalidated');
  });

  it('exposes only fresh, correctly-sided zones via alignedEntryGaps', () => {
    const bars = mkCandles([
      [10, 11, 9.5, 10.5],
      [10.5, 12, 10.4, 11.8],
      [11.8, 13, 11.5, 12.5],
      [12.5, 12.8, 12, 12.2],
    ]);
    const gaps = detectFvgs(bars, bars.length - 1);
    expect(alignedEntryGaps(gaps, 'bullish', 12.2, 3, 10).length).toBe(1);
    expect(alignedEntryGaps(gaps, 'bearish', 12.2, 3, 10)).toEqual([]); // wrong side
    expect(alignedEntryGaps(gaps, 'bullish', 11.4, 3, 10)).toEqual([]); // chasing, not retracement
  });
});

describe('order blocks', () => {
  const breakEvent: StructureEvent = {
    type: 'BOS_BULL',
    index: 5,
    time: 0,
    level: 100,
    close: 101,
  };

  it('picks the last opposing candle before the break and nothing arbitrary', () => {
    const bars = mkCandles([
      [99, 100, 98, 99.5],
      [99.5, 99.8, 98.5, 99], // bearish body @1
      [99, 100.5, 98.8, 100.2], // bullish
      [100.2, 100.8, 99.5, 99.8], // bearish body @3 (last opposing)
      [99.8, 100.2, 99.6, 100],
      [100, 102, 99.9, 101], // break @5
    ]);
    const ob = orderBlockForBreak(bars, breakEvent, 5);
    expect(ob?.index).toBe(3);
    expect(ob).toMatchObject({ direction: 'bullish', top: 100.8, bottom: 99.5 });
  });

  it('returns null when no opposing candle exists in lookback', () => {
    const bars = mkCandles([
      [99, 100, 98, 99.5],
      [99.5, 100.5, 99, 100.2],
      [100.2, 101, 100, 100.8],
    ]);
    const evt: StructureEvent = { type: 'BOS_BULL', index: 2, time: 0, level: 100, close: 100.8 };
    expect(orderBlockForBreak(bars, evt, 5)).toBeNull();
  });

  it('tracks mitigation on wick entry and invalidation on close-through', () => {
    const block = {
      direction: 'bullish' as const,
      top: 100.8,
      bottom: 99.5,
      index: 3,
      createdTime: 0,
      breakIndex: 5,
      mitigated: false,
      invalidated: false,
    };
    const bars = mkCandles([
      [0, 1, 0, 0.5],
      [0, 1, 0, 0.5],
      [0, 1, 0, 0.5],
      [0, 1, 0, 0.5],
      [0, 1, 0, 0.5],
      [0, 1, 0, 0.5],
      [100, 101, 100, 100.5], // wick 100 ≤ top, inside zone → mitigated
      [100.5, 101, 99, 99.2], // close 99.2 < bottom → invalidated
    ]);
    resolveOrderBlock(bars, block, 6);
    expect(block.mitigated).toBe(true);
    expect(block.invalidated).toBe(false);
    resolveOrderBlock(bars, block, 7);
    expect(block.invalidated).toBe(true);
    expect(alignedEntryBlocks([block], 'bullish', 101, 7, 10)).toEqual([]);
  });
});
