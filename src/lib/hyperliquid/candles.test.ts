import { describe, expect, it } from 'vitest';
import {
  alignToCandleOpen,
  intervalMs,
  parseCandle,
  parseCandles,
  selectClosedCandles,
  splitProvisional,
} from './candles.ts';
import type { Candle } from '../types.ts';
import { HyperliquidError } from './client.ts';

const VALID = {
  T: 1681924499999,
  c: '29258.0',
  h: '29309.0',
  i: '15m',
  l: '29250.0',
  n: 189,
  o: '29295.0',
  s: 'xyz:AAPL',
  t: 1681923600000,
  v: '0.98639',
};

function candle(overrides: Partial<Candle> = {}): Candle {
  return {
    time: 1000,
    closeTime: 2000,
    symbol: 'xyz:AAPL',
    interval: '15m',
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume: 5,
    trades: 3,
    ...overrides,
  };
}

describe('parseCandle', () => {
  it('parses a documented candleSnapshot entry', () => {
    const c = parseCandle(VALID);
    expect(c).toMatchObject({
      time: 1681923600000,
      closeTime: 1681924499999,
      symbol: 'xyz:AAPL',
      interval: '15m',
      open: 29295,
      high: 29309,
      low: 29250,
      close: 29258,
      volume: 0.98639,
      trades: 189,
    });
  });

  it('rejects non-objects, bad intervals and non-numeric fields', () => {
    expect(() => parseCandle(null)).toThrow(HyperliquidError);
    expect(() => parseCandle({ ...VALID, i: '9m' })).toThrow(HyperliquidError);
    expect(() => parseCandle({ ...VALID, c: 'abc' })).toThrow(HyperliquidError);
    expect(() => parseCandle({ ...VALID, o: undefined })).toThrow(HyperliquidError);
  });

  it('rejects inverted ranges and out-of-range OHLC', () => {
    expect(() => parseCandle({ ...VALID, h: '1.0', l: '2.0' })).toThrow(HyperliquidError);
    expect(() => parseCandle({ ...VALID, c: '99999.0' })).toThrow(HyperliquidError);
    expect(() => parseCandle({ ...VALID, T: VALID.t })).toThrow(HyperliquidError);
  });
});

describe('parseCandles', () => {
  it('requires an array and validates every entry (no silent drops)', () => {
    expect(() => parseCandles({})).toThrow(HyperliquidError);
    expect(parseCandles([])).toEqual([]);
    expect(() => parseCandles([VALID, { ...VALID, v: 'NaN!' }])).toThrow(HyperliquidError);
  });
});

describe('selectClosedCandles / splitProvisional', () => {
  const closed = candle({ time: 1000, closeTime: 2000 });
  const forming = candle({ time: 2000, closeTime: 3000 });

  it('treats closeTime <= now as closed (boundary inclusive)', () => {
    expect(selectClosedCandles([closed, forming], 2000)).toEqual([closed]);
    expect(selectClosedCandles([closed, forming], 2999)).toEqual([closed]);
    expect(selectClosedCandles([closed, forming], 3000)).toEqual([closed, forming]);
  });

  it('isolates the single provisional candle for display only', () => {
    const split = splitProvisional([closed, forming], 2500);
    expect(split.closed).toEqual([closed]);
    expect(split.provisional).toEqual(forming);
    expect(splitProvisional([closed], 2500).provisional).toBeNull();
  });

  it('fails loudly on multiple open candles instead of hiding look-ahead', () => {
    const two = [forming, candle({ time: 3000, closeTime: 4000 })];
    expect(() => splitProvisional(two, 2500)).toThrow(HyperliquidError);
  });
});

describe('intervalMs / alignToCandleOpen', () => {
  it('maps documented intervals and rejects the rest', () => {
    expect(intervalMs('15m')).toBe(15 * 60_000);
    expect(intervalMs('1h')).toBe(3_600_000);
    expect(() => intervalMs('9m')).toThrow(HyperliquidError);
  });

  it('aligns timestamps down to the candle open', () => {
    expect(alignToCandleOpen(1681923600001, '15m')).toBe(1681923600000);
    expect(alignToCandleOpen(1681923599999, '15m')).toBe(1681922700000);
  });
});
