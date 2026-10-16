/**
 * Supabase sync layer (PostgREST over fetch, no dependencies).
 *
 * Used server-side by scheduled scans with the SERVICE-ROLE key (bypasses
 * RLS; see migration 0002 posture note). Config is passed explicitly — this
 * module never reads ambient secrets, which keeps it testable and prevents
 * accidental browser use with a privileged key. All row mapping is pure and
 * unit-tested; corrupt rows are counted and skipped, never partially applied.
 */
import type { PaperAccount, PaperPosition, Signal } from './types.ts';

export interface SbConfig {
  url: string;
  key: string;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function base(cfg: SbConfig): string {
  return cfg.url.replace(/\/+$/, '');
}

function headers(cfg: SbConfig, extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function readJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    throw new Error(`Supabase ${what} failed: HTTP ${res.status}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    // HTML here almost always means a wrong SUPABASE_URL (dashboard URL,
    // typo, or path suffix) — say so plainly instead of a bare SyntaxError.
    // The snippet below is a server error page, never a secret.
    throw new Error(
      `Supabase ${what} returned a web page, not API JSON (HTTP ${res.status}). ` +
        `Check SUPABASE_URL is exactly https://<project-ref>.supabase.co ` +
        `(Settings → Data API → Project URL, no dashboard path). ` +
        `Body starts: ${text.slice(0, 120)}`,
    );
  }
}

/**
 * Fail fast on malformed Supabase URLs before any network call. Accepts any
 * http(s) API base (including self-hosted) but rejects the common mistake of
 * pasting a dashboard/console URL.
 */
export function validateSbConfig(cfg: SbConfig): void {
  const url = cfg.url.trim();
  if (!/^https?:\/\/.+\..+/.test(url)) {
    throw new Error(`SUPABASE_URL is malformed: ${JSON.stringify(url)}`);
  }
  if (/supabase\.com\/dashboard|supabase\.com\/project|\/rest\/v1\/?$|\/auth\/v1\/?$/.test(url)) {
    throw new Error(
      'SUPABASE_URL looks like a dashboard or endpoint URL. Use exactly ' +
        'https://<project-ref>.supabase.co from Settings → Data API → Project URL.',
    );
  }
}

function toIso(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function fromIso(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/* ------------------------------ mapping ------------------------------ */

export interface SignalRow {
  id: string;
  strategy: string;
  coin: string;
  setup_timeframe: string;
  direction: string;
  state: string;
  setup: unknown;
  no_trade_reason: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  entry_filled_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
  alerted_at: string | null;
}

export function signalToRow(s: Signal & { alertedAt?: number | null }): SignalRow {
  return {
    id: s.id,
    strategy: s.strategy,
    coin: s.coin,
    setup_timeframe: s.setupTimeframe,
    direction: s.direction,
    state: s.state,
    setup: s.setup,
    no_trade_reason: s.noTradeReason,
    note: s.note,
    created_at: toIso(s.createdAt) ?? new Date(0).toISOString(),
    updated_at: toIso(s.updatedAt) ?? new Date(0).toISOString(),
    entry_filled_at: toIso(s.entryFilledAt),
    resolved_at: toIso(s.resolvedAt),
    resolution: s.resolution,
    alerted_at: toIso(s.alertedAt ?? null),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Inverse mapping; returns null for corrupt rows (caller counts them). */
export function rowToSignal(row: unknown): Signal | null {
  if (!isRecord(row)) return null;
  const id = row['id'];
  const coin = row['coin'];
  const state = row['state'];
  const direction = row['direction'];
  const strategy = row['strategy'];
  const setupTimeframe = row['setup_timeframe'];
  if (
    typeof id !== 'string' ||
    typeof coin !== 'string' ||
    typeof state !== 'string' ||
    typeof direction !== 'string' ||
    typeof strategy !== 'string' ||
    typeof setupTimeframe !== 'string'
  ) {
    return null;
  }
  const createdAt = fromIso(row['created_at']) ?? 0;
  const updatedAt = fromIso(row['updated_at']) ?? createdAt;
  const setup = row['setup'];
  return {
    id,
    strategy: strategy as Signal['strategy'],
    coin,
    setupTimeframe: setupTimeframe as Signal['setupTimeframe'],
    direction: direction as Signal['direction'],
    state: state as Signal['state'],
    setup: isRecord(setup) || setup === null ? (setup as Signal['setup']) : null,
    noTradeReason: typeof row['no_trade_reason'] === 'string' ? (row['no_trade_reason'] as Signal['noTradeReason']) : null,
    note: typeof row['note'] === 'string' ? (row['note'] as string) : null,
    createdAt,
    updatedAt,
    entryFilledAt: fromIso(row['entry_filled_at']),
    resolvedAt: fromIso(row['resolved_at']),
    resolution: typeof row['resolution'] === 'string' ? (row['resolution'] as string) : null,
  };
}

export interface TradeRow {
  id: string;
  signal_id: string;
  strategy: string;
  coin: string;
  direction: string;
  entry: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  size: number;
  risk_amount: number;
  opened_at: string;
  status: string;
  tp1_taken: boolean;
  exit_price: number | null;
  exit_reason: string | null;
  closed_at: string | null;
  realized_pnl: number | null;
  realized_r: number | null;
  fees: number;
}

export function positionToRow(p: PaperPosition): TradeRow {
  return {
    id: p.id,
    signal_id: p.signalId,
    strategy: p.strategy,
    coin: p.coin,
    direction: p.direction,
    entry: p.entry,
    stop_loss: p.stopLoss,
    take_profit_1: p.takeProfit1,
    take_profit_2: p.takeProfit2,
    size: p.size,
    risk_amount: p.riskAmount,
    opened_at: toIso(p.openedAt) ?? new Date(0).toISOString(),
    status: p.status,
    tp1_taken: p.tp1Taken,
    exit_price: p.exitPrice,
    exit_reason: p.exitReason,
    closed_at: toIso(p.closedAt),
    realized_pnl: p.realizedPnl,
    realized_r: p.realizedR,
    fees: p.fees,
  };
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

export function rowToPosition(row: unknown): PaperPosition | null {
  if (!isRecord(row)) return null;
  const id = row['id'];
  const signalId = row['signal_id'];
  const coin = row['coin'];
  const direction = row['direction'];
  const strategy = row['strategy'];
  const status = row['status'];
  const entry = num(row['entry']);
  const stopLoss = num(row['stop_loss']);
  const tp1 = num(row['take_profit_1']);
  const tp2 = num(row['take_profit_2']);
  const size = num(row['size']);
  const riskAmount = num(row['risk_amount']);
  const fees = num(row['fees']);
  const openedAt = fromIso(row['opened_at']);
  if (
    typeof id !== 'string' || typeof signalId !== 'string' || typeof coin !== 'string' ||
    (direction !== 'long' && direction !== 'short') ||
    (strategy !== 'smc' && strategy !== 'tech') ||
    (status !== 'open' && status !== 'closed') ||
    entry == null || stopLoss == null || tp1 == null || tp2 == null ||
    size == null || riskAmount == null || fees == null || openedAt == null
  ) {
    return null;
  }
  const exitPrice = num(row['exit_price']);
  const realizedPnl = num(row['realized_pnl']);
  const realizedR = num(row['realized_r']);
  const exitReason = row['exit_reason'];
  const closedAt = fromIso(row['closed_at']);
  const base = {
    id, signalId, strategy: strategy as 'smc' | 'tech', coin,
    direction: direction as 'long' | 'short', entry,
    stopLoss, takeProfit1: tp1, takeProfit2: tp2, size, riskAmount,
    openedAt, tp1Taken: row['tp1_taken'] === true, fees,
  };
  if (status === 'closed') {
    if (exitPrice == null || closedAt == null || typeof exitReason !== 'string' ||
        realizedPnl == null || realizedR == null) {
      return null; // closed trades must be complete — never half-applied
    }
    return {
      ...base, status, exitPrice, exitReason: exitReason as PaperPosition['exitReason'],
      closedAt, realizedPnl, realizedR,
    };
  }
  return {
    ...base, status, exitPrice, exitReason: typeof exitReason === 'string' ? (exitReason as PaperPosition['exitReason']) : null,
    closedAt, realizedPnl, realizedR,
  };
}

export interface AccountRow {
  id: number;
  starting_balance: number;
  balance: number;
  risk_pct: number;
  fee_rate: number;
  slippage_rate: number;
  updated_at: string;
}

export function accountToRow(a: PaperAccount): AccountRow {
  return {
    id: 1,
    starting_balance: a.startingBalance,
    balance: a.balance,
    risk_pct: a.riskPct,
    fee_rate: a.feeRate,
    slippage_rate: a.slippageRate,
    updated_at: new Date().toISOString(),
  };
}

export function rowToAccount(row: unknown): Pick<PaperAccount, 'startingBalance' | 'balance' | 'riskPct' | 'feeRate' | 'slippageRate'> | null {
  if (!isRecord(row)) return null;
  const startingBalance = num(row['starting_balance']);
  const balance = num(row['balance']);
  const riskPct = num(row['risk_pct']);
  const feeRate = num(row['fee_rate']);
  const slippageRate = num(row['slippage_rate']);
  if (startingBalance == null || balance == null || riskPct == null || feeRate == null || slippageRate == null) {
    return null;
  }
  return { startingBalance, balance, riskPct, feeRate, slippageRate };
}

/* -------------------------------- IO --------------------------------- */

const http: FetchFn = (url, init) => fetch(url, init);

export async function loadSignals(
  cfg: SbConfig,
  fetchFn: FetchFn = http,
): Promise<{ signals: Signal[]; skipped: number }> {
  const res = await fetchFn(
    `${base(cfg)}/rest/v1/smc_signals?select=*&order=updated_at.desc&limit=2000`,
    { headers: headers(cfg) },
  );
  const rows = await readJson<unknown[]>(res, 'load signals');
  const signals: Signal[] = [];
  let skipped = 0;
  for (const row of rows) {
    const s = rowToSignal(row);
    if (s) signals.push(s);
    else skipped += 1;
  }
  return { signals, skipped };
}

export async function upsertSignals(
  cfg: SbConfig,
  signals: Signal[],
  fetchFn: FetchFn = http,
): Promise<void> {
  if (signals.length === 0) return;
  // Chunked: PostgREST + Actions-friendly sizes.
  for (let i = 0; i < signals.length; i += 200) {
    const chunk = signals.slice(i, i + 200).map((s) => signalToRow(s));
    const res = await fetchFn(`${base(cfg)}/rest/v1/smc_signals?on_conflict=id`, {
      method: 'POST',
      headers: headers(cfg, { Prefer: 'resolution=merge-duplicates' }),
      body: JSON.stringify(chunk),
    });
    await readJson<unknown>(res, 'upsert signals');
  }
}

export async function loadTrades(
  cfg: SbConfig,
  fetchFn: FetchFn = http,
): Promise<{ open: PaperPosition[]; closed: PaperPosition[]; skipped: number }> {
  const res = await fetchFn(
    `${base(cfg)}/rest/v1/smc_paper_trades?select=*&order=opened_at.desc&limit=2000`,
    { headers: headers(cfg) },
  );
  const rows = await readJson<unknown[]>(res, 'load trades');
  const open: PaperPosition[] = [];
  const closed: PaperPosition[] = [];
  let skipped = 0;
  for (const row of rows) {
    const p = rowToPosition(row);
    if (!p) {
      skipped += 1;
      continue;
    }
    if (p.status === 'closed') closed.push(p);
    else open.push(p);
  }
  return { open, closed, skipped };
}

export async function upsertTrades(
  cfg: SbConfig,
  trades: PaperPosition[],
  fetchFn: FetchFn = http,
): Promise<void> {
  if (trades.length === 0) return;
  for (let i = 0; i < trades.length; i += 200) {
    const chunk = trades.slice(i, i + 200).map(positionToRow);
    const res = await fetchFn(`${base(cfg)}/rest/v1/smc_paper_trades?on_conflict=id`, {
      method: 'POST',
      headers: headers(cfg, { Prefer: 'resolution=merge-duplicates' }),
      body: JSON.stringify(chunk),
    });
    await readJson<unknown>(res, 'upsert trades');
  }
}

export async function loadAccount(
  cfg: SbConfig,
  fetchFn: FetchFn = http,
): Promise<ReturnType<typeof rowToAccount>> {
  const res = await fetchFn(`${base(cfg)}/rest/v1/smc_paper_account?id=eq.1&select=*`, {
    headers: headers(cfg),
  });
  const rows = await readJson<unknown[]>(res, 'load account');
  if (rows.length === 0) return null;
  return rowToAccount(rows[0]);
}

export async function saveAccount(
  cfg: SbConfig,
  account: PaperAccount,
  fetchFn: FetchFn = http,
): Promise<void> {
  const res = await fetchFn(`${base(cfg)}/rest/v1/smc_paper_account?on_conflict=id`, {
    method: 'POST',
    headers: headers(cfg, { Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify(accountToRow(account)),
  });
  await readJson<unknown>(res, 'save account');
}

export interface ScanSummary {
  dexCount: number;
  totalAssets: number;
  verifiedStocks: number;
  excluded: number;
  signalsNew: number;
  error: string | null;
}

export async function recordScan(
  cfg: SbConfig,
  summary: ScanSummary,
  fetchFn: FetchFn = http,
): Promise<void> {
  const res = await fetchFn(`${base(cfg)}/rest/v1/smc_scans`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({
      dex_count: summary.dexCount,
      total_assets: summary.totalAssets,
      verified_stocks: summary.verifiedStocks,
      excluded: summary.excluded,
      signals_new: summary.signalsNew,
      error: summary.error,
    }),
  });
  await readJson<unknown>(res, 'record scan');
}

/** Mark signals as alerted (dedupe across runs). Returns claimed count. */
export async function markAlerted(
  cfg: SbConfig,
  ids: string[],
  fetchFn: FetchFn = http,
): Promise<void> {
  if (ids.length === 0) return;
  const list = ids.map((id) => `"${id.replace(/"/g, '')}"`).join(',');
  const res = await fetchFn(`${base(cfg)}/rest/v1/smc_signals?id=in.(${list})`, {
    method: 'PATCH',
    headers: headers(cfg),
    body: JSON.stringify({ alerted_at: new Date().toISOString() }),
  });
  await readJson<unknown>(res, 'mark alerted');
}

/** Fresh, unalerted, tradable signals eligible for delivery. */
export async function loadAlertCandidates(
  cfg: SbConfig,
  fetchFn: FetchFn = http,
): Promise<Signal[]> {
  const res = await fetchFn(
    `${base(cfg)}/rest/v1/smc_signals?select=*&state=in.(WAITING_FOR_RETEST,ACTIVE)&alerted_at=is.null&order=updated_at.desc&limit=100`,
    { headers: headers(cfg) },
  );
  const rows = await readJson<unknown[]>(res, 'load alert candidates');
  const out: Signal[] = [];
  for (const row of rows) {
    const s = rowToSignal(row);
    if (s) out.push(s);
  }
  return out;
}
