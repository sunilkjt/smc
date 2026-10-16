/**
 * Shared deterministic candle fixtures for SMC tests (NOT live data).
 * Geometries here are hand-verified: longSetupBars produces a full long
 * setup under the test engine config; sweepFreeBars cannot sweep by
 * construction (monotonic legs → zero swings → zero liquidity).
 */
import type { Candle, EngineConfig } from '../types.ts';
import { mkCandles } from './smc-core.test.ts';

export const TEST_CFG: EngineConfig = {
  swingStrength: 1,
  equalTolerance: 0.002,
  sweepLookback: 15,
  fvgLookback: 15,
  structureLookback: 20,
  signalExpiryBars: 3,
  minRiskReward: 2,
  atrPeriod: 5,
  atrStopBuffer: 0.25,
  minTargetAtrMultiple: 0.5,
  contextTimeframe: '1h',
  setupTimeframe: '15m',
  entryTimeframe: '5m',
};

type Row = [number, number, number, number];

/** 32-bar V-sweep-rally long scenario (see setup.test.ts docstring). */
export function longSetupBars(): Candle[] {
  const rows: Row[] = [
    [107.5, 107.8, 107.2, 107.5],
    [107.5, 108.1, 107.4, 108.0],
    [108.0, 108.1, 107.5, 107.8],
    [107.8, 108.5, 107.7, 108.2],
    [108.2, 108.3, 107.6, 107.9],
    [107.9, 108.2, 107.8, 108.1],
    [108.1, 108.2, 107.4, 107.7],
    [107.7, 107.7, 105.7, 106.0],
    [106.0, 106.0, 105.2, 105.5],
    [105.5, 105.5, 104.7, 105.0],
    [105.0, 105.0, 104.2, 104.5],
    [104.5, 104.5, 103.7, 104.0],
    [104.0, 104.0, 103.2, 103.5],
    [103.5, 103.5, 102.7, 103.0],
    [103.0, 103.0, 102.2, 102.5],
    [102.5, 102.5, 101.7, 102.0],
    [102.0, 102.0, 101.2, 101.5],
    [101.5, 101.5, 100.7, 101.0],
    [101.0, 101.0, 100.2, 100.5],
    [100.5, 100.5, 99.7, 100.0],
    [100.0, 100.3, 99.2, 99.5],
    [99.5, 100.1, 99.4, 99.8],
    [99.8, 100.3, 99.7, 100.0],
    [100.0, 100.4, 98.8, 100.2],
    [100.2, 100.8, 100.0, 100.5],
    [100.0, 100.2, 99.0, 99.2],
    [99.2, 103.0, 99.5, 102.8],
    [102.8, 103.3, 102.7, 103.0],
    [103.0, 103.6, 103.1, 103.5],
    [103.5, 103.8, 103.4, 103.7],
    [103.7, 104.0, 103.6, 103.9],
  ];
  return mkCandles(rows, 900_000);
}

/** Monotonic fall then rise: zero swings → zero liquidity → no sweep possible. */
export function sweepFreeBars(): Candle[] {
  const rows: Row[] = [];
  for (let i = 0; i < 32; i += 1) {
    const c = 110 - i * 0.3;
    rows.push([c + 0.3, c + 0.3, c - 0.3, c]);
  }
  for (let i = 0; i < 12; i += 1) {
    const c = 100.4 + i * 0.5;
    rows.push([c - 0.5, c + 0.3, c - 0.3, c]);
  }
  return mkCandles(rows, 900_000);
}

/** Rising zigzag HTF context → bullish trend with BOS breaks. */
export function bullishContext(): Candle[] {
  const rows: Row[] = [];
  for (let i = 0; i < 40; i += 1) {
    const c = 100 + i * 1.1 + (i % 2 === 0 ? 0.6 : -0.6);
    const o = i === 0 ? c : 100 + (i - 1) * 1.1 + ((i - 1) % 2 === 0 ? 0.6 : -0.6);
    rows.push([o, c + 0.5, c - 0.5, c]);
  }
  return mkCandles(rows, 3_600_000);
}

export function bearishContext(): Candle[] {
  const rows: Row[] = [];
  for (let i = 0; i < 40; i += 1) {
    const c = 140 - i * 1.1 + (i % 2 === 0 ? -0.6 : 0.6);
    const o = i === 0 ? c : 140 - (i - 1) * 1.1 + ((i - 1) % 2 === 0 ? -0.6 : 0.6);
    rows.push([o, c + 0.5, c - 0.5, c]);
  }
  return mkCandles(rows, 3_600_000);
}

/** Mirror a series vertically (long geometry becomes short geometry). */
export function invertBars(bars: Candle[]): Candle[] {
  return bars.map((c) => ({
    ...c,
    open: 200 - c.open,
    high: 200 - c.low,
    low: 200 - c.high,
    close: 200 - c.close,
  }));
}
