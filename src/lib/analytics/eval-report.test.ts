import { describe, expect, it } from 'vitest';
import {
  buildEvalReport,
  classifyRegime,
  renderEvalReport,
} from './eval-report.ts';
import type { ClosedTrade, Signal } from '../types.ts';

function trade(id: string, r: number, coin = 'xyz:A', strategy: 'smc' | 'tech' = 'smc'): ClosedTrade {
  return {
    id, signalId: `sig-${id}`, strategy, coin, direction: 'long',
    entry: 100, stopLoss: 96, takeProfit1: 108, takeProfit2: 112, size: 25,
    riskAmount: 100, openedAt: 1, status: 'closed', tp1Taken: false,
    exitPrice: 100 + r * 4, exitReason: r > 0 ? 'TP1' : 'STOP', closedAt: 2,
    realizedPnl: r * 100, realizedR: r, fees: 1,
  };
}

function signalFor(t: ClosedTrade, setupTimeframe = '15m'): Signal {
  return {
    id: t.signalId, strategy: t.strategy, coin: t.coin, setupTimeframe: setupTimeframe as Signal['setupTimeframe'],
    direction: 'long', state: 'RESOLVED', setup: null, noTradeReason: null, note: null,
    createdAt: 0, updatedAt: 0, entryFilledAt: 1, resolvedAt: 2, resolution: 'TP1',
  };
}

describe('classifyRegime', () => {
  it('buckets 60d returns with fixed documented thresholds', () => {
    expect(classifyRegime(0.2)).toBe('bull');
    expect(classifyRegime(-0.2)).toBe('bear');
    expect(classifyRegime(0.05)).toBe('range');
    expect(classifyRegime(0.15)).toBe('range'); // strict boundary
    expect(classifyRegime(null)).toBe('unknown');
    expect(classifyRegime(Number.NaN)).toBe('unknown');
  });
});

describe('buildEvalReport', () => {
  it('keeps strategies separate and splits market/timeframe/regime', () => {
    const trades = [trade('a', 2, 'xyz:A', 'smc'), trade('b', -1, 'xyz:B', 'smc'), trade('c', 1, 'xyz:A', 'tech')];
    const signals = new Map(trades.map((t) => [t.signalId, signalFor(t)]));
    const regimes = new Map([['a', 0.3], ['b', -0.3], ['c', 0.0]]);
    const report = buildEvalReport(trades, regimes, signals, 7);
    expect(report.trades).toBe(3);
    expect(report.generatedAt).toBe(7);
    expect(report.byStrategy.find((g) => g.key === 'smc')?.metrics.completed).toBe(2);
    expect(report.byStrategy.find((g) => g.key === 'tech')?.metrics.totalR).toBeCloseTo(1, 9);
    expect(report.byMarket.length).toBe(2);
    expect(report.byTimeframe.find((g) => g.key === '15m')?.metrics.completed).toBe(3);
    expect(report.byRegime.find((g) => g.key === 'bull')?.metrics.completed).toBe(1);
    expect(report.unclassified).toEqual([]);
  });

  it('lists missing regimes as unclassified (never silently dropped)', () => {
    const trades = [trade('a', 1)];
    const report = buildEvalReport(trades, new Map(), new Map(), 7);
    expect(report.byRegime).toEqual([]);
    expect(report.unclassified).toEqual(['a']);
  });

  it('renders an honest empty report (no fabricated statistics)', () => {
    const report = buildEvalReport([], new Map(), new Map(), 7);
    const text = renderEvalReport(report);
    expect(text).toContain('Trades evaluated: 0');
    expect(text).toContain('(none)');
    expect(text).not.toContain('NaN');
  });
});
