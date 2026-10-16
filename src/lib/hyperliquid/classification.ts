/**
 * Equity-market classification.
 *
 * Rule (documented, deterministic):
 * - A market is classified as `STOCK` if and only if the builder-declared
 *   `perpCategories` entry for its FULL identifier (e.g. `"xyz:AAPL"`)
 *   normalizes to an equity label.
 * - Accepted equity labels (case-insensitive, singular/plural): `stocks`,
 *   `stock`, `equities`, `equity`.
 * - Everything else — crypto, forex, commodities, indices, rates, pre-IPO,
 *   missing entries, empty strings — classifies as `UNKNOWN` and is excluded
 *   from stock signals until verified by other means.
 *
 * Rationale: Hyperliquid hosts many HIP-3 markets whose tickers look familiar
 * (e.g. an index or FX pair). Ticker text alone must never imply equity.
 * Builder category metadata is the only machine-readable equity signal the
 * public API currently exposes, and it is imperfect (e.g. bond ETFs may be
 * labelled `stocks`), so classification stays conservative and the UI carries
 * a derivatives disclaimer.
 */

import type { MarketClass } from '../types.ts';

/** Equity labels accepted after normalization. */
const STOCK_LABELS = new Set(['stocks', 'stock', 'equities', 'equity']);

/** Normalize a raw category value for comparison. */
export function normalizeCategory(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}

/** True when the raw builder category denotes an equity market. */
export function isStockCategory(raw: unknown): boolean {
  return STOCK_LABELS.has(normalizeCategory(raw));
}

/** Classify a market from its raw builder category. */
export function classifyMarket(rawCategory: unknown): MarketClass {
  return isStockCategory(rawCategory) ? 'STOCK' : 'UNKNOWN';
}

/**
 * Split a full coin id into its DEX prefix and base coin.
 * `"xyz:AAPL"` -> `{ dex: "xyz", coin: "AAPL" }`.
 * `"BTC"`      -> `{ dex: "", coin: "BTC" }` (main perp DEX).
 * Only the first colon separates the DEX prefix; the remainder is the coin.
 */
export function splitCoinId(full: string): { dex: string; coin: string } {
  const idx = full.indexOf(':');
  if (idx < 0) return { dex: '', coin: full };
  return { dex: full.slice(0, idx), coin: full.slice(idx + 1) };
}
