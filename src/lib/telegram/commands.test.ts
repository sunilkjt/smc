import { describe, expect, it } from 'vitest';
import {
  formatPositions,
  formatSignals,
  formatStatus,
  isOwner,
  parseCommand,
  splitReply,
} from './commands.ts';
import type { PaperPosition, Signal } from '../types.ts';

describe('parseCommand', () => {
  it('parses slash commands with args and @bot suffixes', () => {
    expect(parseCommand('/scan')).toEqual({ command: 'scan', args: [] });
    expect(parseCommand('/scan 5')).toEqual({ command: 'scan', args: ['5'] });
    expect(parseCommand('/scan@smc_bot 5')).toEqual({ command: 'scan', args: ['5'] });
    expect(parseCommand('/STATUS')).toEqual({ command: 'status', args: [] });
  });

  it('rejects non-commands and maps unknown input to help', () => {
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand('')).toBeNull();
    expect(parseCommand(null)).toBeNull();
    expect(parseCommand('/nuke')).toEqual({ command: 'help', args: [] });
  });

  it('gates ownership by exact chat id match', () => {
    expect(isOwner(1745489575, '1745489575')).toBe(true);
    expect(isOwner('1745489575', '1745489575')).toBe(true);
    expect(isOwner(999, '1745489575')).toBe(false);
    expect(isOwner(undefined, '1745489575')).toBe(false);
  });
});

describe('formatters', () => {
  it('formats status, empty states included', () => {
    expect(formatStatus(null, 0)).toContain('No scheduled scan');
    const text = formatStatus(
      { ranAt: new Date(1000).toISOString(), verifiedStocks: 129, signalsNew: 2, error: null },
      1,
    );
    expect(text).toContain('129');
    expect(text).toContain('Open paper positions: 1');
  });

  it('formats positions and signals without inventing numbers', () => {
    expect(formatPositions([])).toContain('No open paper positions');
    const position = {
      direction: 'long', coin: 'xyz:A', size: 1.5, entry: 100, stopLoss: 96,
      takeProfit1: 108, takeProfit2: 114, riskAmount: 6, tp1Taken: false,
    } as PaperPosition;
    expect(formatPositions([position])).toContain('LONG xyz:A');
    expect(formatSignals([])).toContain('NO_TRADE');
    const signal = {
      state: 'WAITING_FOR_RETEST',
      setup: {
        direction: 'short', coin: 'xyz:B', setupTimeframe: '15m', entry: 50,
        stopLoss: 52, takeProfit1: 46, takeProfit2: 44, riskReward1: 2,
      },
    } as Signal;
    expect(formatSignals([signal])).toContain('SELL xyz:B');
  });

  it('splits long replies without cutting lines', () => {
    const long = Array.from({ length: 200 }, (_, i) => `line-${i}-padding-xxxxx`).join('\n');
    const parts = splitReply(long, 500);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 500)).toBe(true);
    expect(parts.join('\n')).toBe(long);
  });
});
