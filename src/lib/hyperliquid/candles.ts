/**
 * Candle retrieval, parsing and closed-candle selection.
 *
 * Hard rules:
 * - Only `candleSnapshot` responses with the documented shape are accepted.
 *   Any malformed entry aborts the whole fetch with `invalid-response` —
 *   entries are never silently dropped or repaired, and a failed fetch never
 *   yields an empty "successful" candle set.
 * - Signal scoring must use `selectClosedCandles` (`closeTime <= now`).
 *   The still-forming candle is exposed separately as `provisional` for
 *   display only and must be labelled as such in the UI.
 * - Full coin identifiers (including HIP-3 `dex:` prefixes) are preserved
 *   verbatim in requests and results.
 */

import { HyperliquidError, isRecord, postInfo, type PostInfoOptions } from './client.ts';
import type { Candle, CandleInterval, CandleSet, FullCoinId } from '../types.ts';

export const CANDLE_INTERVALS: readonly CandleInterval[] = [
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '8h',
  '12h',
  '1d',
  '3d',
  '1w',
  '1M',
];

const MINUTE_MS = 60_000;

export const INTERVAL_MS: Record<CandleInterval, number> = {
  '1m': MINUTE_MS,
  '3m': 3 * MINUTE_MS,
  '5m': 5 * MINUTE_MS,
  '15m': 15 * MINUTE_MS,
  '30m': 30 * MINUTE_MS,
  '1h': 60 * MINUTE_MS,
  '2h': 2 * 60 * MINUTE_MS,
  '4h': 4 * 60 * MINUTE_MS,
  '8h': 8 * 60 * MINUTE_MS,
  '12h': 12 * 60 * MINUTE_MS,
  '1d': 24 * 60 * MINUTE_MS,
  '3d': 3 * 24 * 60 * MINUTE_MS,
  '1w': 7 * 24 * 60 * MINUTE_MS,
  '1M': 30 * 24 * 60 * MINUTE_MS,
};

/** Milliseconds per candle for a documented interval; throws otherwise. */
export function intervalMs(interval: string): number {
  const ms = (INTERVAL_MS as Record<string, number | undefined>)[interval];
  if (ms == null) {
    throw new HyperliquidError(
      'invalid-response',
      `Unsupported candle interval: ${JSON.stringify(interval)}`,
    );
  }
  return ms;
}

function toFiniteNumber(value: unknown, field: string, coin: string): number {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) {
    throw new HyperliquidError(
      'invalid-response',
      `Invalid candle field ${field} for ${coin}: ${JSON.stringify(value)}`,
    );
  }
  return n;
}

function toInt(value: unknown, field: string, coin: string): number {
  const n = toFiniteNumber(value, field, coin);
  if (!Number.isInteger(n)) {
    throw new HyperliquidError(
      'invalid-response',
      `Invalid candle field ${field} for ${coin}: expected integer, got ${JSON.stringify(value)}`,
    );
  }
  return n;
}

/**
 * Validate and convert one raw `candleSnapshot` entry. Throws
 * `HyperliquidError(kind='invalid-response')` on any defect.
 */
export function parseCandle(raw: unknown): Candle {
  if (!isRecord(raw)) {
    throw new HyperliquidError('invalid-response', 'Candle entry is not an object');
  }
  const coin = typeof raw['s'] === 'string' ? raw['s'] : 'unknown';
  const interval = raw['i'];
  if (typeof interval !== 'string' || !(CANDLE_INTERVALS as readonly string[]).includes(interval)) {
    throw new HyperliquidError(
      'invalid-response',
      `Invalid candle interval for ${coin}: ${JSON.stringify(interval)}`,
    );
  }
  const time = toInt(raw['t'], 't', coin);
  const closeTime = toInt(raw['T'], 'T', coin);
  if (closeTime <= time) {
    throw new HyperliquidError(
      'invalid-response',
      `Invalid candle time range for ${coin}: T (${closeTime}) <= t (${time})`,
    );
  }
  const open = toFiniteNumber(raw['o'], 'o', coin);
  const high = toFiniteNumber(raw['h'], 'h', coin);
  const low = toFiniteNumber(raw['l'], 'l', coin);
  const close = toFiniteNumber(raw['c'], 'c', coin);
  if (high < low) {
    throw new HyperliquidError(
      'invalid-response',
      `Invalid candle range for ${coin} @ ${time}: high (${high}) < low (${low})`,
    );
  }
  for (const [label, px] of [
    ['open', open],
    ['high', high],
    ['low', low],
    ['close', close],
  ] as const) {
    if (px < low || px > high) {
      throw new HyperliquidError(
        'invalid-response',
        `Invalid candle ${label} for ${coin} @ ${time}: ${px} outside [${low}, ${high}]`,
      );
    }
  }
  return {
    time,
    closeTime,
    symbol: coin,
    interval: interval as CandleInterval,
    open,
    high,
    low,
    close,
    volume: toFiniteNumber(raw['v'], 'v', coin),
    trades: toInt(raw['n'], 'n', coin),
  };
}

/** Validate a full `candleSnapshot` payload (must be an array; every entry checked). */
export function parseCandles(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) {
    throw new HyperliquidError('invalid-response', 'candleSnapshot response is not an array');
  }
  return raw.map((entry) => parseCandle(entry));
}

function isCandleArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export interface FetchCandlesOptions extends PostInfoOptions {
  now?: number;
}

/**
 * Fetch candles for a full coin id and interval over `[startTime, endTime)`.
 * Returns closed vs provisional split. Throws on network/shape failure.
 * Sparse windows (no trades) legitimately return zero candles — callers must
 * treat that as "no data", never as zero volume or a signal.
 */
export async function fetchCandles(
  coin: FullCoinId,
  interval: CandleInterval,
  startTime: number,
  endTime: number,
  opts?: FetchCandlesOptions,
): Promise<CandleSet> {
  if (!Number.isInteger(startTime) || !Number.isInteger(endTime) || endTime <= startTime) {
    throw new HyperliquidError(
      'invalid-response',
      `Invalid candle window: [${String(startTime)}, ${String(endTime)})`,
    );
  }
  intervalMs(interval); // validates early
  const raw = await postInfo(
    { type: 'candleSnapshot', req: { coin, interval, startTime, endTime } },
    isCandleArray,
    opts,
  );
  const candles = parseCandles(raw).sort((a, b) => a.time - b.time);
  const now = opts?.now ?? Date.now();
  const { closed, provisional } = splitProvisional(candles, now);
  return { coin, interval, closed, provisional, fetchedAt: now };
}

/** Confirmed closed candles only (`closeTime <= now`), in ascending order. */
export function selectClosedCandles(candles: Candle[], now: number = Date.now()): Candle[] {
  return candles.filter((c) => c.closeTime <= now);
}

/**
 * Split candles into confirmed closed candles and the single still-forming
 * candle (the latest one whose `closeTime` is in the future), if any.
 */
export function splitProvisional(
  candles: Candle[],
  now: number = Date.now(),
): { closed: Candle[]; provisional: Candle | null } {
  const closed = selectClosedCandles(candles, now);
  const open = candles.filter((c) => c.closeTime > now);
  // At most one provisional candle can exist per (coin, interval) series; if
  // the API ever returns more, keep the latest and surface the anomaly by
  // treating the earlier ones as closed would be look-ahead — so drop them
  // loudly via an error instead.
  if (open.length > 1) {
    throw new HyperliquidError(
      'invalid-response',
      `Multiple open candles returned for ${candles[0]?.symbol ?? 'unknown'} (${open.length})`,
    );
  }
  return { closed, provisional: open.length === 1 ? open[0] : null };
}

/** Start of the candle bucket containing `time` for `interval`. */
export function alignToCandleOpen(time: number, interval: CandleInterval): number {
  return Math.floor(time / intervalMs(interval)) * intervalMs(interval);
}
