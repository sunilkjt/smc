import { describe, expect, it } from 'vitest';
import { summarizeR, summarizeTrades, groupTrades } from './performance.ts';
import type { ClosedTrade } from '../types.ts';
import { emaSeries, rsiSeries, macdSeries, relativeVolume } from '../tech/indicators.ts';
import { evaluateTech, techSignalFromEvaluation } from '../tech/strategy.ts';
import type { Candle } from '../types.ts';

function trade(r: number, coin = 'xyz:A', strategy: 'smc' | 'tech' = 'smc'): ClosedTrade {
  return {
    id: `t${r}${coin}`,
    signalId: `s${r}${coin}`,
    strategy,
    coin,
    direction: r >= 0 ? 'long' : 'short',
    entry: 100,
    stopLoss: 96,
    takeProfit1: 108,
    takeProfit2: 112,
    size: 25,
    riskAmount: 100,
    openedAt: 1,
    status: 'closed',
    tp1Taken: false,
    exitPrice: 100 + r * 4,
    exitReason: r > 0 ? 'TP1' : 'STOP',
    closedAt: 2,
    realizedPnl: r * 100,
    realizedR: r,
    fees: 1,
  };
}

describe('summarizeR', () => {
  it('computes win rate, expectancy, profit factor and drawdown', () => {
    const m = summarizeR([2, 2, -1, 1, -1]);
    expect(m.completed).toBe(5);
    expect(m.wins).toBe(3);
    expect(m.winRate).toBeCloseTo(0.6, 9);
    expect(m.expectancyR).toBeCloseTo(0.6, 9);
    expect(m.profitFactor).toBeCloseTo(5 / 2, 9);
    expect(m.totalR).toBeCloseTo(3, 9);
    expect(m.smallSample).toBe(true); // n < 10
  });

  it('flags real samples and returns honest empty states', () => {
    const big = summarizeR(new Array(12).fill(1));
    expect(big.smallSample).toBe(false);
    const empty = summarizeR([]);
    expect(empty.completed).toBe(0);
    expect(empty.winRate).toBeNull();
    expect(empty.expectancyR).toBeNull();
    expect(empty.profitFactor).toBeNull();
    expect(empty.maxDrawdownR).toBeNull();
    expect(empty.smallSample).toBe(true);
  });

  it('summarizes and groups closed trades without mixing unfilled setups', () => {
    const trades = [trade(2, 'xyz:A', 'smc'), trade(-1, 'xyz:B', 'smc'), trade(1, 'xyz:A', 'tech')];
    expect(summarizeTrades(trades).completed).toBe(3);
    const byMarket = groupTrades(trades, 'market');
    expect(byMarket.length).toBe(2);
    const byStrategy = groupTrades(trades, 'strategy');
    expect(byStrategy.find((g) => g.key === 'smc')?.metrics.completed).toBe(2);
    expect(byStrategy.find((g) => g.key === 'tech')?.metrics.completed).toBe(1);
  });
});

describe('indicators', () => {
  // Accelerating rally with periodic dips: keeps momentum readings alive
  // (a perfectly linear ramp drives RSI to exactly 100 and MACD hist to 0).
  const rising = Array.from(
    { length: 250 },
    (_, i) => 100 + i * 0.5 + i * i * 0.0005 - (i % 7 === 0 ? 2.6 : 0),
  );

  it('ema converges toward price and rsi bounds 0-100 (hot on rallies)', () => {
    const ema = emaSeries(rising, 20);
    const last = ema[ema.length - 1] as number;
    expect(last).toBeGreaterThan(rising[0] as number);
    expect(last).toBeLessThan(rising[rising.length - 1] as number);
    const rsi = rsiSeries(rising, 14);
    const lastRsi = rsi[rsi.length - 1] as number;
    expect(lastRsi).toBeGreaterThan(70);
    expect(lastRsi).toBeLessThanOrEqual(100);
    expect(emaSeries([1, 2], 20).every((v) => Number.isNaN(v))).toBe(true);
  });

  it('macd histogram is positive on sustained rallies', () => {
    const { hist } = macdSeries(rising);
    expect(hist[hist.length - 1]).toBeGreaterThan(0);
  });

  it('relative volume compares against the trailing mean only', () => {
    const vols = [...new Array(20).fill(10), 30];
    expect(relativeVolume(vols, 20)).toBeCloseTo(3, 9);
    expect(relativeVolume([1, 2, 3], 20)).toBeNull();
  });
});

describe('evaluateTech', () => {
  function trendCandles(n: number, slope: number, step: number, spread: number): Candle[] {
    return Array.from({ length: n }, (_, i) => {
      // Grinding rally with periodic dips: sustains RSI in-band and MACD>0.
      const dip = i % 7 === 0 ? 3.3 : 0;
      const c = 100 + i * slope + i * i * 0.0005 - dip;
      const time = i * step;
      return {
        time, closeTime: time + step - 1, symbol: 'T', interval: '15m',
        open: c - slope / 2, high: c + spread, low: c - spread, close: c,
        volume: 100 + (i % 5) * 3, trades: 10,
      } as Candle;
    });
  }

  /** Mean-reverting chop: price oscillates around a flat mean (no trend stack). */
  function chopCandles(
    n: number,
    amp: number,
    period: number,
    phase: number,
    step: number,
    spread: number,
  ): Candle[] {
    return Array.from({ length: n }, (_, i) => {
      const c = 100 + amp * Math.sin(i / period + phase);
      const time = i * step;
      return {
        time, closeTime: time + step - 1, symbol: 'T', interval: '15m',
        open: c - 0.2, high: c + spread, low: c - spread, close: c,
        volume: 100 + (i % 5) * 3, trades: 10,
      } as Candle;
    });
  }

  it('goes long on a clean supported uptrend, silent on chop', () => {
    const up = trendCandles(220, 0.3, 900_000, 0.4);
    const htf = trendCandles(70, 1.2, 3_600_000, 1);
    const long = evaluateTech({ coin: 'x', candles: up, htf });
    expect(long.direction).toBe('long');
    expect(long.plan).not.toBeNull();
    // ATR-derived plan is exactly 2R/4R/6R by construction.
    const plan = long.plan as { entry: number; stopLoss: number; takeProfit1: number; takeProfit2: number };
    const risk = plan.entry - plan.stopLoss;
    expect((plan.takeProfit1 - plan.entry) / risk).toBeCloseTo(2, 6);
    expect((plan.takeProfit2 - plan.entry) / risk).toBeCloseTo(3, 6);

    const chop = chopCandles(220, 8, 5, 0, 900_000, 2);
    const flatHtf = chopCandles(70, 6, 4, 1, 3_600_000, 3);
    expect(evaluateTech({ coin: 'x', candles: chop, htf: flatHtf }).direction).toBe('none');
  });

  it('refuses short history instead of guessing', () => {
    const few = trendCandles(50, 0.5, 900_000, 0.4);
    const out = evaluateTech({ coin: 'x', candles: few, htf: few });
    expect(out.direction).toBe('none');
    expect(out.reasons[0]).toContain('insufficient history');
  });

  it('converts passing evaluations into first-class tech signals', () => {
    const up = trendCandles(220, 0.3, 900_000, 0.4);
    const htf = trendCandles(70, 1.2, 3_600_000, 1);
    const evaluation = evaluateTech({ coin: 'xyz:T', candles: up, htf });
    expect(evaluation.direction).toBe('long');
    const last = up[up.length - 1] as Candle;
    const signal = techSignalFromEvaluation(
      'xyz:T', evaluation, '15m', up.length - 1, last.closeTime, last.closeTime, 99,
    );
    expect(signal?.strategy).toBe('tech');
    expect(signal?.state).toBe('WAITING_FOR_RETEST');
    expect(signal?.id.startsWith('tech:xyz:T:15m:long:')).toBe(true);
    expect(signal?.setup?.riskReward1).toBeCloseTo(2, 6);
    expect(signal?.setup?.riskReward2).toBeCloseTo(3, 6);
    expect(signal?.setup?.qualityPassed).toBe(signal?.setup?.qualityTotal);

    const chop = chopCandles(220, 8, 5, 0, 900_000, 2);
    const flatHtf = chopCandles(70, 6, 4, 1, 3_600_000, 3);
    const none = evaluateTech({ coin: 'x', candles: chop, htf: flatHtf });
    expect(
      techSignalFromEvaluation('x', none, '15m', 219, 1, 1, 1),
    ).toBeNull();
  });
});
