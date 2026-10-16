import { describe, expect, it, vi } from 'vitest';
import {
  loadAccount,
  loadSignals,
  loadTrades,
  markAlerted,
  positionToRow,
  recordScan,
  rowToPosition,
  rowToSignal,
  saveAccount,
  signalToRow,
  upsertSignals,
  upsertTrades,
  validateSbConfig,
  type SbConfig,
} from './supabase-sync.ts';
import type { PaperPosition, Signal } from './types.ts';

const CFG: SbConfig = { url: 'https://example.supabase.co', key: 'service-role-key' };

function signal(): Signal {
  return {
    id: 'smc:xyz:AAPL:15m:long:123:ab',
    strategy: 'smc',
    coin: 'xyz:AAPL',
    setupTimeframe: '15m',
    direction: 'long',
    state: 'WAITING_FOR_RETEST',
    setup: null,
    noTradeReason: null,
    note: null,
    createdAt: 1_000_000,
    updatedAt: 2_000_000,
    entryFilledAt: null,
    resolvedAt: null,
    resolution: null,
  };
}

function okJson(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 });
}

describe('row mapping', () => {
  it('round-trips signals through rows (timestamps as ISO)', () => {
    const row = signalToRow(signal());
    expect(row.created_at).toBe(new Date(1_000_000).toISOString());
    expect(row.setup).toBeNull();
    const back = rowToSignal(row);
    expect(back).toMatchObject({ id: signal().id, createdAt: 1_000_000, updatedAt: 2_000_000 });
  });

  it('rejects corrupt signal rows instead of half-applying', () => {
    expect(rowToSignal(null)).toBeNull();
    expect(rowToSignal({ id: 'x' })).toBeNull();
    expect(rowToSignal({ ...signalToRow(signal()), coin: 42 })).toBeNull();
  });

  it('round-trips positions and rejects incomplete closed trades', () => {
    const open: PaperPosition = {
      id: 'paper:x', signalId: 's', strategy: 'smc', coin: 'xyz:T', direction: 'long',
      entry: 100, stopLoss: 96, takeProfit1: 108, takeProfit2: 114, size: 25,
      riskAmount: 100, openedAt: 5_000, status: 'open', tp1Taken: false,
      exitPrice: null, exitReason: null, closedAt: null,
      realizedPnl: null, realizedR: null, fees: 1,
    };
    expect(rowToPosition(positionToRow(open))).toMatchObject({ id: 'paper:x', status: 'open' });
    const closedRow = { ...positionToRow({ ...open, status: 'closed' }) };
    expect(rowToPosition(closedRow)).toBeNull(); // missing exit fields
    const complete = {
      ...closedRow, exit_price: 108, exit_reason: 'TP1', closed_at: new Date(9_000).toISOString(),
      realized_pnl: 200, realized_r: 2,
    };
    expect(rowToPosition(complete)).toMatchObject({ status: 'closed', realizedR: 2 });
  });
});

describe('sync IO (mocked fetch)', () => {
  it('loads signals, skipping corrupt rows with a count', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson([signalToRow(signal()), { id: 'bad' }]));
    const { signals, skipped } = await loadSignals(CFG, fetchMock);
    expect(signals.length).toBe(1);
    expect(skipped).toBe(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/rest/v1/smc_signals');
  });

  it('upserts in chunks with merge-duplicates and skips empty input', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson([]));
    await upsertSignals(CFG, [], fetchMock);
    expect(fetchMock).not.toHaveBeenCalled();
    await upsertSignals(CFG, [signal()], fetchMock);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('on_conflict=id');
    expect((init.headers as Record<string, string>)['Prefer']).toContain('merge-duplicates');
    const body = JSON.parse(init.body as string) as unknown[];
    expect(body.length).toBe(1);
  });

  it('splits loaded trades into open/closed and counts skips', async () => {
    const open: PaperPosition = {
      id: 'o', signalId: 's', strategy: 'smc', coin: 'c', direction: 'long', entry: 1,
      stopLoss: 0.9, takeProfit1: 1.1, takeProfit2: 1.2, size: 1, riskAmount: 0.1,
      openedAt: 1, status: 'open', tp1Taken: false, exitPrice: null, exitReason: null,
      closedAt: null, realizedPnl: null, realizedR: null, fees: 0,
    };
    const fetchMock = vi.fn().mockResolvedValue(okJson([positionToRow(open), { nope: 1 }]));
    const { open: o, closed, skipped } = await loadTrades(CFG, fetchMock);
    expect(o.length).toBe(1);
    expect(closed.length).toBe(0);
    expect(skipped).toBe(1);
    await upsertTrades(CFG, [], fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('loads/saves the single-row account and records scans', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okJson([{ id: 1, starting_balance: 10000, balance: 9900, risk_pct: 1, fee_rate: 0.00045, slippage_rate: 0.0002 }]),
      )
      .mockImplementation(() => Promise.resolve(okJson([])));
    const account = await loadAccount(CFG, fetchMock);
    expect(account).toMatchObject({ startingBalance: 10000, balance: 9900 });
    await saveAccount(
      CFG,
      { startingBalance: 10000, balance: 9900, riskPct: 1, feeRate: 0.00045, slippageRate: 0.0002, openPositions: [], closedTrades: [] },
      fetchMock,
    );
    await recordScan(
      CFG,
      { dexCount: 11, totalAssets: 541, verifiedStocks: 129, excluded: 412, signalsNew: 2, error: null },
      fetchMock,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('marks alerted ids and no-ops on empty input', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson([]));
    await markAlerted(CFG, [], fetchMock);
    expect(fetchMock).not.toHaveBeenCalled();
    await markAlerted(CFG, ['a', 'b'], fetchMock);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('id=in.');
    expect(init.method).toBe('PATCH');
  });

  it('surfaces HTTP failures as errors (never silent)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('denied', { status: 401 }));
    await expect(loadSignals(CFG, fetchMock)).rejects.toThrow('HTTP 401');
  });

  it('explains HTML responses as a wrong SUPABASE_URL (not a bare SyntaxError)', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response('<!DOCTYPE html><html>nope</html>', { status: 200 })),
      );
    await expect(loadSignals(CFG, fetchMock)).rejects.toThrow('not API JSON');
  });

  it('validateSbConfig rejects dashboard/endpoint URLs and accepts API bases', () => {
    expect(() => validateSbConfig({ url: 'https://supabase.com/dashboard/project/abc', key: 'k' })).toThrow(
      'dashboard or endpoint URL',
    );
    expect(() => validateSbConfig({ url: 'https://abc.supabase.co/rest/v1', key: 'k' })).toThrow(
      'dashboard or endpoint URL',
    );
    expect(() => validateSbConfig({ url: 'not a url', key: 'k' })).toThrow('malformed');
    expect(() =>
      validateSbConfig({ url: 'https://abc.supabase.co', key: 'k' }),
    ).not.toThrow();
  });
});
