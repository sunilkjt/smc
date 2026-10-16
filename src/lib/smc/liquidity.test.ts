import { describe, expect, it } from 'vitest';
import { findSwings } from './swings.ts';
import { detectSweeps, liquidityLevels } from './liquidity.ts';
import { mkCandles } from './smc-core.test.ts';

function seriesWithSwingLow() {
  // Swing low 90 @ index 3 (k=1), then candles to sweep or touch it.
  return mkCandles([
    [100, 101, 99, 100],
    [100, 102, 98, 101],
    [101, 103, 100, 102],
    [102, 102.5, 90, 95], // swing low 90 @3
    [95, 96, 93, 94],
  ]);
}

describe('liquidityLevels', () => {
  it('maps swing highs/lows to buy/sell-side levels', () => {
    const bars = seriesWithSwingLow();
    const swings = findSwings(bars, 1, bars.length - 1);
    const levels = liquidityLevels(swings, bars.length - 1, 0.001);
    // Bar 1 is itself a swing low (98); the sweepable level is swing-low@3.
    const sell = levels.find((l) => l.origin === 'swing-low@3');
    expect(sell?.price).toBe(90);
    expect(sell?.side).toBe('sellside');
  });

  it('detects equal highs within tolerance and ignores distant ones', () => {
    const bars = mkCandles([
      [10, 10.5, 9.5, 10],
      [10, 12, 9.9, 11],
      [11, 11.5, 10.6, 10.8],
      [10.8, 11, 10, 10.2],
      [10.2, 12.01, 10.1, 11], // ≈ equal high (0.08% apart)
      [11, 11.4, 10.8, 11],
      [11, 11.2, 10.9, 11],
      [11, 13, 10.9, 12.5], // far high — not equal
      [12.5, 12.8, 12, 12.2],
    ]);
    const swings = findSwings(bars, 1, bars.length - 1);
    const levels = liquidityLevels(swings, bars.length - 1, 0.001);
    const equals = levels.filter((l) => l.origin.startsWith('equal-highs'));
    expect(equals.length).toBe(1);
    expect(equals[0]?.price).toBeCloseTo(12.005, 6);
  });
});

describe('detectSweeps', () => {
  it('confirms a sweep only on wick-pierce plus close-back (touch alone fails)', () => {
    // Exact-touch candle: low == 90 (not strictly through) → NO sweep.
    const touchBars = seriesWithSwingLow();
    touchBars.push({
      time: 9_999_999,
      closeTime: 10_059_998,
      symbol: 'TEST',
      interval: '15m',
      open: 94,
      high: 95,
      low: 90,
      close: 93,
      volume: 1,
      trades: 1,
    });
    const swings = findSwings(touchBars, 1, touchBars.length - 1);
    const levels = liquidityLevels(swings, touchBars.length - 1, 0.001).filter(
      (l) => l.side === 'sellside',
    );
    expect(detectSweeps(touchBars, levels, touchBars.length - 1)).toEqual([]);

    // True sweep: low 89.5 < 90 with close 93 > 90.
    const sweepBars = seriesWithSwingLow();
    sweepBars.push({
      time: 9_999_999,
      closeTime: 10_059_998,
      symbol: 'TEST',
      interval: '15m',
      open: 94,
      high: 95,
      low: 89.5,
      close: 93,
      volume: 1,
      trades: 1,
    });
    const swings2 = findSwings(sweepBars, 1, sweepBars.length - 1);
    const levels2 = liquidityLevels(swings2, sweepBars.length - 1, 0.001).filter(
      (l) => l.side === 'sellside',
    );
    const sweeps = detectSweeps(sweepBars, levels2, sweepBars.length - 1);
    expect(sweeps.length).toBe(1);
    expect(sweeps[0]?.extreme).toBe(89.5);
  });

  it('ignores sweeps by candles at/before the level creation bar', () => {
    const bars = seriesWithSwingLow();
    const swings = findSwings(bars, 1, bars.length - 1);
    const levels = liquidityLevels(swings, bars.length - 1, 0.001);
    // asOfIndex 3: only bars ≤ 3 considered; the swing low bar itself dips to
    // 90 but equals (not strictly through) → no sweep regardless.
    expect(detectSweeps(bars, levels, 3)).toEqual([]);
  });
});
