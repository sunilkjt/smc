import { describe, expect, it } from 'vitest';
import { formatSignalAlert, shouldSendAlert } from './format.ts';
import type { Signal, SmcSetup } from '../types.ts';

function setup(overrides?: Partial<SmcSetup>): SmcSetup {
  return {
    coin: 'xyz:AAPL',
    contextTimeframe: '1h',
    setupTimeframe: '15m',
    entryTimeframe: '5m',
    direction: 'long',
    entry: 340,
    entryZoneTop: 340,
    entryZoneBottom: 338,
    stopLoss: 336,
    takeProfit1: 348,
    takeProfit2: 352,
    riskReward1: 2,
    riskReward2: 3.5,
    setupIndex: 100,
    signalTime: 1_000_000,
    dataTime: 1_000_000,
    conditions: [],
    qualityPassed: 8,
    qualityTotal: 8,
    explanation: 'sweep + BOS',
    zoneSources: ['bullish-OB@99'],
    ...overrides,
  };
}

function signal(overrides?: Partial<Signal>): Signal {
  return {
    id: 'smc:xyz:AAPL:15m:long:1000000:abc',
    strategy: 'smc',
    coin: 'xyz:AAPL',
    setupTimeframe: '15m',
    direction: 'long',
    state: 'WAITING_FOR_RETEST',
    setup: setup(),
    noTradeReason: null,
    note: null,
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    entryFilledAt: null,
    resolvedAt: null,
    resolution: null,
    ...overrides,
  };
}

describe('formatSignalAlert', () => {
  it('includes entry, stop, targets, RR and signal time', () => {
    const text = formatSignalAlert(signal()) as string;
    for (const part of ['BUY xyz:AAPL', '340', '336', '348', '352', 'RR', '1970']) {
      expect(text).toContain(part);
    }
  });

  it('renders nothing for diagnostic signals', () => {
    expect(formatSignalAlert(signal({ setup: null }))).toBeNull();
  });
});

describe('shouldSendAlert', () => {
  const filter = { strategies: ['smc' as const], coins: [] as string[], minQuality: 6 };

  it('sends fresh tradable signals once', () => {
    const s = signal();
    expect(shouldSendAlert(s, filter, new Set(), 1_000_000 + 60_000)).toBe(true);
    expect(shouldSendAlert(s, filter, new Set([s.id]), 1_000_000 + 60_000)).toBe(false);
  });

  it('suppresses diagnostics, stale data, filtered strategies and weak setups', () => {
    const s = signal();
    expect(shouldSendAlert({ ...s, state: 'NO_TRADE', setup: null }, filter, new Set(), 1_000_000)).toBe(false);
    expect(shouldSendAlert(s, filter, new Set(), 1_000_000 + 60 * 60_000)).toBe(false); // stale
    expect(
      shouldSendAlert(s, { ...filter, strategies: ['tech'] }, new Set(), 1_000_000),
    ).toBe(false);
    expect(
      shouldSendAlert(
        { ...s, setup: setup({ qualityPassed: 3 }) },
        filter,
        new Set(),
        1_000_000,
      ),
    ).toBe(false);
  });
});
