import { describe, expect, it } from 'vitest';
import {
  createAccount,
  openFromSignal,
  resolvePositions,
  unrealizedPnl,
} from './engine.ts';
import type { Candle, PaperPosition, Signal, SmcSetup } from '../types.ts';

function bar(
  time: number,
  o: number,
  h: number,
  l: number,
  c: number,
): Candle {
  return {
    time,
    closeTime: time + 899_999,
    symbol: 'xyz:T',
    interval: '15m',
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 5,
    trades: 2,
  };
}

function activeSignal(overrides?: Partial<SmcSetup>): Signal {
  const setup: SmcSetup = {
    coin: 'xyz:T',
    contextTimeframe: '1h',
    setupTimeframe: '15m',
    entryTimeframe: '5m',
    direction: 'long',
    entry: 100,
    entryZoneTop: 100,
    entryZoneBottom: 98,
    stopLoss: 96,
    takeProfit1: 108,
    takeProfit2: 114,
    riskReward1: 2,
    riskReward2: 3.5,
    setupIndex: 10,
    signalTime: 1_000_000,
    dataTime: 1_000_000,
    conditions: [],
    qualityPassed: 8,
    qualityTotal: 8,
    explanation: 'test',
    zoneSources: ['bullish-OB@9'],
    ...overrides,
  };
  return {
    id: 'smc:xyz:T:15m:long:1000000:abcd1234',
    strategy: 'smc',
    coin: 'xyz:T',
    setupTimeframe: '15m',
    direction: 'long',
    state: 'ACTIVE',
    setup,
    noTradeReason: null,
    note: null,
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    entryFilledAt: 1_100_000,
    resolvedAt: null,
    resolution: null,
  };
}

describe('openFromSignal', () => {
  it('sizes by risk with entry fee deducted, one position per signal', () => {
    const account = createAccount({ startingBalance: 10_000, riskPct: 1 });
    const { account: next, position } = openFromSignal(account, activeSignal(), 1_100_000);
    // risk $100 / stop distance ~4.02 (after slippage) ≈ size 24.9
    expect(position).not.toBeNull();
    expect(position?.size ?? 0).toBeGreaterThan(0);
    expect(next.balance).toBeLessThan(10_000); // entry fee deducted
    expect(next.openPositions.length).toBe(1);
    const again = openFromSignal(next, activeSignal(), 1_200_000);
    expect(again.position).toBeNull(); // never reopen
  });

  it('refuses unfilled signals and caps notional at equity (no leverage)', () => {
    const account = createAccount({ startingBalance: 100 });
    const waiting = { ...activeSignal(), state: 'WAITING_FOR_RETEST' as const };
    expect(openFromSignal(account, waiting, 0).position).toBeNull();

    // Tiny stop distance would imply huge size → capped at equity.
    const tight = activeSignal({ entry: 100, stopLoss: 99.99 });
    const { position } = openFromSignal(account, { ...activeSignal(), setup: tight.setup }, 0);
    expect(position).not.toBeNull();
    expect((position?.size ?? 0) * (position?.entry ?? 0)).toBeLessThanOrEqual(100.0001);
  });
});

describe('resolvePositions', () => {
  it('takes TP1 partially then TP2, with R from total PnL', () => {
    const account = createAccount({ feeRate: 0, slippageRate: 0 });
    const opened = openFromSignal(account, activeSignal(), 2_000_000).account;
    const done = resolvePositions(opened, [
      bar(3_000_000, 104, 109, 103, 108.5), // strict through TP1 108
      bar(4_000_000, 109, 115, 108, 114), // strict through TP2 114
    ]);
    expect(done.openPositions.length).toBe(0);
    expect(done.closedTrades.length).toBe(1);
    const trade = done.closedTrades[0] as PaperPosition;
    expect(trade.exitReason).toBe('TP2');
    expect(trade.tp1Taken).toBe(true);
    // Half at +8, half at +14 over risk 4 → R = (4+7)/4 = 2.75
    expect(trade.realizedR ?? 0).toBeCloseTo(2.75, 6);
  });

  it('resolves stop-first when one candle hits both stop and target', () => {
    const account = createAccount({ feeRate: 0, slippageRate: 0 });
    const opened = openFromSignal(account, activeSignal(), 2_000_000).account;
    const done = resolvePositions(opened, [bar(3_000_000, 100, 120, 90, 110)]);
    const trade = done.closedTrades[0] as PaperPosition;
    expect(trade.exitReason).toBe('STOP');
    expect(trade.realizedR ?? 0).toBeCloseTo(-1, 6);
  });

  it('ignores mere touches of stop and target', () => {
    const account = createAccount({ feeRate: 0, slippageRate: 0 });
    const opened = openFromSignal(account, activeSignal(), 2_000_000).account;
    const same = resolvePositions(opened, [
      bar(3_000_000, 100, 108, 96, 104), // high == TP1, low == SL: touches only
    ]);
    expect(same.openPositions.length).toBe(1);
    expect(same.closedTrades.length).toBe(0);
  });

  it('keeps the runner after TP1 and stops it at the original stop', () => {
    const account = createAccount({ feeRate: 0, slippageRate: 0 });
    const opened = openFromSignal(account, activeSignal(), 2_000_000).account;
    const done = resolvePositions(opened, [
      bar(3_000_000, 104, 109, 103, 107),
      bar(4_000_000, 100, 101, 95, 96), // runner stopped
    ]);
    const trade = done.closedTrades[0] as PaperPosition;
    expect(trade.exitReason).toBe('STOP');
    // Half +8, half −4 over risk 4 → R = (4 − 2)/4 = 0.5
    expect(trade.realizedR ?? 0).toBeCloseTo(0.5, 6);
  });

  it('deducts fees and slippage from balance', () => {
    const withCosts = createAccount({});
    const opened = openFromSignal(withCosts, activeSignal(), 2_000_000).account;
    const entryFees = opened.openPositions[0]?.fees ?? 0;
    expect(entryFees).toBeGreaterThan(0);
    const done = resolvePositions(opened, [bar(3_000_000, 100, 120, 90, 95)]);
    expect(done.balance).toBeLessThan(10_000);
    expect(done.closedTrades[0]?.realizedPnl ?? 0).toBeLessThan(0); // stopped, net of fees
    expect((done.closedTrades[0]?.fees ?? 0)).toBeGreaterThan(entryFees);
  });

  it('leaves untouched positions open (never auto-completes)', () => {
    const account = createAccount({ feeRate: 0, slippageRate: 0 });
    const opened = openFromSignal(account, activeSignal(), 2_000_000).account;
    const same = resolvePositions(opened, [bar(3_000_000, 100, 102, 99, 101)]);
    expect(same.openPositions.length).toBe(1);
    expect(unrealizedPnl(same.openPositions[0] as PaperPosition, 101)).toBeGreaterThan(0);
  });
});
