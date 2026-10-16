import { describe, expect, it } from 'vitest';
import { analyzeStructure, dealingRange, premiumDiscount } from './structure.ts';
import { findSwings } from './swings.ts';
import { mkCandles } from './smc-core.test.ts';

describe('analyzeStructure', () => {
  it('emits BOS while trend continues and CHoCH on the first reversal break', () => {
    // Uptrend making/breaking highs, then a collapse through the low.
    const bars = mkCandles([
      [10, 10.5, 9.5, 10],
      [10, 11, 9.8, 10.8],
      [10.8, 12, 10.5, 11.5], // swing high 12 @2 (confirmed @4)
      [11.5, 11.8, 10.8, 11],
      [11, 11.2, 9, 9.5], // swing low 9 @4
      [9.5, 12.5, 9.2, 12.2], // close 12.2 > 12 → CHOCH_BULL (trend was neutral)
      [12.2, 13, 12, 12.8], // swing high 13 @6
      [12.8, 12.9, 12.1, 12.4],
      [12.4, 12.6, 12, 12.2],
      [12.2, 13.5, 12.1, 13.2], // close 13.2 > 13 → BOS_BULL
      [13.2, 13.4, 11, 11.2],
      [11.2, 11.5, 8, 8.5], // close 8.5 < 9 → CHOCH_BEAR
    ]);
    const swings = findSwings(bars, 1, bars.length - 1);
    const state = analyzeStructure(bars, swings, bars.length - 1);
    const types = state.events.map((e) => e.type);
    expect(types).toEqual(['CHOCH_BULL', 'BOS_BULL', 'CHOCH_BEAR']);
    expect(state.trend).toBe('bearish');
  });

  it('never breaks against a swing formed by future bars', () => {
    const bars = mkCandles([
      [10, 10.2, 9.8, 10],
      [10, 10.3, 9.9, 10.1],
      [10.1, 12, 10, 11.9],
      [11.9, 12.1, 11.5, 11.6],
    ]);
    const swings = findSwings(bars, 1, bars.length - 1);
    const state = analyzeStructure(bars, swings, 2); // swing @2 unconfirmed as of bar 2
    expect(state.events).toEqual([]);
  });
});

describe('dealingRange / premiumDiscount', () => {
  it('builds equilibrium and classifies zones', () => {
    const bars = mkCandles([
      [10, 10.5, 9.5, 10],
      [10, 12, 9.8, 11],
      [11, 11.5, 10.5, 10.8],
      [10.8, 11, 8, 8.5],
      [8.5, 9, 8.2, 8.8],
    ]);
    const swings = findSwings(bars, 1, bars.length - 1);
    const range = dealingRange(swings, bars.length - 1);
    expect(range).not.toBeNull();
    expect(range?.high).toBe(12);
    expect(range?.low).toBe(8);
    expect(range ? premiumDiscount(range, 11.5) : null).toBe('premium');
    expect(range ? premiumDiscount(range, 8.5) : null).toBe('discount');
    expect(range ? premiumDiscount(range, 10) : null).toBe('equilibrium');
  });

  it('returns null without a full swing pair', () => {
    expect(dealingRange([], 10)).toBeNull();
  });
});
