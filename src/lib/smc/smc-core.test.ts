import { describe, expect, it } from 'vitest';
import type { Candle } from '../types.ts';
import { atr, trueRange } from './atr.ts';
import { findSwings, lastSwing } from './swings.ts';

let t = 1_000_000;

/** Build ascending-time candles from [open, high, low, close] tuples. */
export function mkCandles(rows: Array<[number, number, number, number]>, step = 60_000): Candle[] {
  return rows.map(([o, h, l, c], i) => {
    const time = t + i * step;
    return {
      time,
      closeTime: time + step - 1,
      symbol: 'TEST',
      interval: '15m',
      open: o,
      high: h,
      low: l,
      close: c,
      volume: 10,
      trades: 5,
    };
  });
}

describe('trueRange / atr', () => {
  it('uses high-low for the first bar and prior close afterwards', () => {
    const bars = mkCandles([
      [10, 12, 9, 11],
      [11, 13, 10, 12],
    ]);
    expect(trueRange(bars, 0)).toBe(3);
    expect(trueRange(bars, 1)).toBe(3); // max(3, |13-11|, |10-11|)
  });

  it('computes a positive Wilder ATR and requires enough bars', () => {
    const bars = mkCandles(
      Array.from({ length: 20 }, (_, i) => [10 + i, 12 + i, 9 + i, 11 + i] as [number, number, number, number]),
    );
    const value = atr(bars, 14, 19);
    expect(value).toBeGreaterThan(0);
    expect(() => atr(bars, 14, 13)).toThrow();
  });
});

describe('findSwings', () => {
  // Peak of 10 at index 2 with k=1 confirmation on both sides.
  const bars = mkCandles([
    [8, 8.5, 7.5, 8],
    [8, 9, 7.8, 8.5],
    [8.5, 10, 8.2, 9],
    [9, 9.2, 8, 8.4],
    [8.4, 8.6, 7, 7.2],
    [7.2, 7.5, 6, 6.5],
    [6.5, 7, 6.2, 6.8],
  ]);

  it('detects strict-fractal swings with causal confirmation times', () => {
    const swings = findSwings(bars, 1);
    const high = swings.find((s) => s.side === 'high');
    const low = swings.find((s) => s.side === 'low');
    expect(high?.index).toBe(2);
    expect(high?.price).toBe(10);
    expect(high?.confirmedAt).toBe(bars[3]?.closeTime);
    expect(low?.index).toBe(5);
    expect(low?.price).toBe(6);
  });

  it('vetoes swings on equal highs/lows (equality is liquidity, not structure)', () => {
    const flat = mkCandles([
      [8, 9, 8, 8.5],
      [8.5, 10, 8.4, 9],
      [9, 10, 8.9, 9.2], // equal high 10 — no swing at 1 or 2
      [9.2, 9.5, 9, 9.1],
    ]);
    expect(findSwings(flat, 1).filter((s) => s.side === 'high')).toEqual([]);
  });

  it('is causal: asOfIndex never reveals later-confirmed swings (no look-ahead)', () => {
    const early = findSwings(bars, 1, 3);
    const full = findSwings(bars, 1);
    expect(early.every((s) => full.some((f) => f.index === s.index && f.price === s.price))).toBe(true);
    expect(early.find((s) => s.side === 'low')).toBeUndefined(); // low needs bar 6
  });

  it('lastSwing returns the latest swing of a side', () => {
    const swings = findSwings(bars, 1);
    expect(lastSwing(swings, 'high', 6)?.index).toBe(2);
    expect(lastSwing(swings, 'low', 3)).toBeNull();
  });
});
