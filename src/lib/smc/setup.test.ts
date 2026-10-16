import { describe, expect, it } from 'vitest';
import { generateSetup } from './setup.ts';
import type { Candle, CandleInterval, EngineConfig } from '../types.ts';
import { DEFAULT_ENGINE_CONFIG } from '../types.ts';
import { mkCandles } from './smc-core.test.ts';

const CFG: EngineConfig = {
  swingStrength: 1,
  equalTolerance: 0.002,
  sweepLookback: 15,
  fvgLookback: 15,
  structureLookback: 20,
  signalExpiryBars: 48,
  minRiskReward: 2,
  atrPeriod: 5,
  atrStopBuffer: 0.25,
  minTargetAtrMultiple: 0.5,
  contextTimeframe: '1h',
  setupTimeframe: '15m',
  entryTimeframe: '5m',
};

type Row = [number, number, number, number];

/**
 * Hand-built long scenario (32 bars):
 * - bars 0-6: plateau (swing high 108.5, the TP1 liquidity).
 * - bars 7-17: monotonic fall (no swings — no accidental levels).
 * - bars 18-22: single V (swing low 99.2 @20; swing high 100.8 @24).
 * - bar 23: sell-side sweep (low 98.8, close back 100.2).
 * - bar 24: green, bar 25: red order block [99.0, 100.2].
 * - bar 26: bullish BOS through 100.8 (close 102.8, no same-bar sweep).
 * - bars 27-31: rising tail (no new swings, sweeps or shifts).
 */
function longSetupBars(): Candle[] {
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
    [100.0, 99.8, 99.2, 99.5],
    [99.5, 100.1, 99.4, 99.8],
    [99.8, 100.3, 99.7, 100.0],
    [100.0, 100.4, 98.8, 100.2],
    [100.2, 100.8, 100.0, 100.5],
    [100.0, 100.2, 99.0, 99.2],
    [99.2, 103.0, 99.5, 102.8],
    [102.8, 103.3, 102.7, 103.0],
    [103.0, 103.5, 102.9, 103.2],
    [103.2, 103.6, 103.1, 103.5],
    [103.5, 103.8, 103.4, 103.7],
    [103.7, 104.0, 103.6, 103.9],
  ];
  return mkCandles(rows, 900_000);
}

/** Monotonic fall then rise: zero swings → zero liquidity → no sweep possible. */
function sweepFreeBars(): Candle[] {
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
function bullishContext(): Candle[] {
  const rows: Row[] = [];
  for (let i = 0; i < 40; i += 1) {
    const c = 100 + i * 1.1 + (i % 2 === 0 ? 0.6 : -0.6);
    const o = i === 0 ? c : 100 + (i - 1) * 1.1 + ((i - 1) % 2 === 0 ? 0.6 : -0.6);
    rows.push([o, c + 0.5, c - 0.5, c]);
  }
  return mkCandles(rows, 3_600_000);
}

function bearishContext(): Candle[] {
  const rows: Row[] = [];
  for (let i = 0; i < 40; i += 1) {
    const c = 140 - i * 1.1 + (i % 2 === 0 ? -0.6 : 0.6);
    const o = i === 0 ? c : 140 - (i - 1) * 1.1 + ((i - 1) % 2 === 0 ? -0.6 : 0.6);
    rows.push([o, c + 0.5, c - 0.5, c]);
  }
  return mkCandles(rows, 3_600_000);
}

/** Mirror a series vertically (long geometry becomes short geometry). */
function invert(bars: Candle[]): Candle[] {
  return bars.map((c) => ({
    ...c,
    open: 200 - c.open,
    high: 200 - c.low,
    low: 200 - c.high,
    close: 200 - c.close,
  }));
}

describe('generateSetup (long)', () => {
  it('defaults to a 1:1.5 minimum risk/reward (quality bar, user-tunable)', () => {
    expect(DEFAULT_ENGINE_CONFIG.minRiskReward).toBe(1.5);
  });

  it('builds a full setup with structural SL and RR-gated targets', () => {
    const setup = longSetupBars();
    const context = bullishContext();
    const now = setup[setup.length - 1]?.closeTime ?? 0;
    const result = generateSetup(
      { coin: 'xyz:TEST', context, setup, config: CFG, dataNow: now },
      'long',
    );
    if (result.kind !== 'setup') {
      throw new Error(`expected setup, got ${result.reason}: ${result.detail}`);
    }
    const s = result.setup;
    expect(s.direction).toBe('long');
    expect(s.stopLoss).toBeLessThan(s.entryZoneBottom);
    expect(s.stopLoss).toBeLessThan(s.entry);
    expect(s.entry).toBeLessThan(s.takeProfit1);
    expect(s.riskReward1).toBeGreaterThanOrEqual(2);
    expect(s.qualityPassed).toBe(s.qualityTotal);
    expect(s.explanation.length).toBeGreaterThan(20);
    expect(s.zoneSources.length).toBeGreaterThanOrEqual(1);
    expect(s.signalTime).toBeLessThanOrEqual(s.dataTime);
  });

  it('mirrors for shorts on inverted data', () => {
    const setup = invert(longSetupBars());
    const context = bearishContext();
    const now = setup[setup.length - 1]?.closeTime ?? 0;
    const result = generateSetup(
      { coin: 'xyz:TEST', context, setup, config: CFG, dataNow: now },
      'short',
    );
    if (result.kind !== 'setup') {
      throw new Error(`expected setup, got ${result.reason}: ${result.detail}`);
    }
    expect(result.setup.direction).toBe('short');
    expect(result.setup.stopLoss).toBeGreaterThan(result.setup.entryZoneTop);
    expect(result.setup.riskReward1).toBeGreaterThanOrEqual(2);
  });
});

describe('generateSetup (no-trade paths)', () => {
  it('rejects without HTF context', () => {
    const setup = longSetupBars();
    const flat = mkCandles(
      new Array(40).fill([100, 100.3, 99.7, 100] as Row),
      3_600_000,
    );
    const now = setup[setup.length - 1]?.closeTime ?? 0;
    const result = generateSetup(
      { coin: 'xyz:TEST', context: flat, setup, config: CFG, dataNow: now },
      'long',
    );
    expect(result.kind).toBe('no-trade');
    if (result.kind === 'no-trade') expect(result.reason).toBe('NO_HTF_CONTEXT');
  });

  it('rejects when no liquidity event exists', () => {
    const setup = sweepFreeBars();
    const context = bullishContext();
    const now = setup[setup.length - 1]?.closeTime ?? 0;
    const result = generateSetup(
      { coin: 'xyz:TEST', context, setup, config: CFG, dataNow: now },
      'long',
    );
    expect(result.kind).toBe('no-trade');
    if (result.kind === 'no-trade') expect(result.reason).toBe('NO_LIQUIDITY_EVENT');
  });

  it('rejects weak RR, stale data and short history with distinct reasons', () => {
    const setup = longSetupBars();
    const context = bullishContext();
    const now = setup[setup.length - 1]?.closeTime ?? 0;

    const strict = generateSetup(
      { coin: 'x', context, setup, config: { ...CFG, minRiskReward: 50 }, dataNow: now },
      'long',
    );
    expect(strict.kind).toBe('no-trade');
    if (strict.kind === 'no-trade') expect(strict.reason).toBe('RR_TOO_LOW');

    const stale = generateSetup(
      { coin: 'x', context, setup, config: CFG, dataNow: now + 10 * 900_000 },
      'long',
    );
    expect(stale.kind).toBe('no-trade');
    if (stale.kind === 'no-trade') expect(stale.reason).toBe('STALE_OR_MISSING_DATA');

    const short = generateSetup(
      { coin: 'x', context, setup: setup.slice(0, 10), config: CFG, dataNow: now },
      'long',
    );
    expect(short.kind).toBe('no-trade');
    if (short.kind === 'no-trade') expect(short.reason).toBe('STALE_OR_MISSING_DATA');
  });

  it('does not repaint: sideways extension keeps setup levels frozen', () => {
    const base = longSetupBars();
    const context = bullishContext();
    const nowBase = base[base.length - 1]?.closeTime ?? 0;
    const first = generateSetup(
      { coin: 'xyz:TEST', context, setup: base, config: CFG, dataNow: nowBase },
      'long',
    );
    if (first.kind !== 'setup') {
      throw new Error(`expected base setup, got ${first.reason}: ${first.detail}`);
    }
    const lastClose = base[base.length - 1]?.close ?? 0;
    const lastTime = base[base.length - 1]?.time ?? 0;
    const extra: Candle[] = [];
    for (let i = 1; i <= 4; i += 1) {
      const time = lastTime + i * 900_000;
      extra.push({
        time,
        closeTime: time + 900_000 - 1,
        symbol: 'TEST',
        interval: '15m' as CandleInterval,
        open: lastClose,
        high: lastClose + 0.15,
        low: lastClose - 0.15,
        close: lastClose,
        volume: 1,
        trades: 1,
      });
    }
    const extended = [...base, ...extra];
    const nowExt = extended[extended.length - 1]?.closeTime ?? 0;
    const second = generateSetup(
      { coin: 'xyz:TEST', context, setup: extended, config: CFG, dataNow: nowExt },
      'long',
    );
    if (second.kind !== 'setup') {
      throw new Error(`expected extended setup, got ${second.reason}: ${second.detail}`);
    }
    expect(second.setup.setupIndex).toBe(first.setup.setupIndex);
    expect(second.setup.entry).toBe(first.setup.entry);
    expect(second.setup.stopLoss).toBe(first.setup.stopLoss);
    expect(second.setup.takeProfit1).toBe(first.setup.takeProfit1);
  });
});
