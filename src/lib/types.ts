/**
 * Core domain types for Hyperliquid SMC Stocks.
 *
 * These interfaces are shared by the market-data adapter, SMC calculations,
 * signal lifecycle, paper trading and analytics modules. Every rule that
 * consumes these types must use confirmed, validated data only — never
 * invented prices, symbols or classifications.
 */

/** Full Hyperliquid market identifier. HIP-3 markets keep their builder DEX
 *  prefix, e.g. `"xyz:AAPL"`. Main-dex markets are unprefixed, e.g. `"BTC"`. */
export type FullCoinId = string;

/** Builder DEX name, e.g. `"xyz"`. Empty string denotes the main perp DEX. */
export type DexName = string;

/** Verified classification of a discovered market. Markets whose metadata
 *  cannot reliably identify them as equity-linked are `UNKNOWN` and are
 *  excluded from stock signals until verified. */
export type MarketClass = 'STOCK' | 'UNKNOWN';

/** A currently available, tradable market discovered via live API responses. */
export interface Market {
  /** Exact market identifier, including any builder DEX prefix. */
  id: FullCoinId;
  /** Builder DEX name (`""` for the main perp DEX). */
  dex: DexName;
  /** Base coin without the DEX prefix, e.g. `"AAPL"`. */
  coin: string;
  /** Human-readable DEX label from `perpDexs`, if available. */
  dexFullName?: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
  /** Raw builder-declared category from `perpCategories`, if any. */
  builderCategory?: string;
  classification: MarketClass;
  /** Latest mark/mid/oracle prices from asset contexts, when present. */
  markPx?: number;
  midPx?: number;
  oraclePx?: number;
  prevDayPx?: number;
  dayNtlVlm?: number;
  openInterest?: number;
}

/** Result of a market-discovery scan. Network errors are thrown, never
 *  converted into an empty result — an empty `markets` array always means the
 *  scan genuinely succeeded and nothing met the verification criteria. */
export interface DiscoveryResult {
  /** Verified stock/equity-linked markets, sorted by 24h notional desc. */
  markets: Market[];
  /** Count of assets seen but excluded (non-stock or UNKNOWN). */
  excludedCount: number;
  /** Small sample of excluded assets with reasons, for diagnostics. */
  excludedSample: Array<{ id: string; reason: string }>;
  /** Number of perp DEXes observed in `allPerpMetas`. */
  dexCount: number;
  /** Total assets observed across all DEXes. */
  totalAssets: number;
  /** `Date.now()` when the scan completed successfully. */
  fetchedAt: number;
}

/** Supported Hyperliquid candle intervals. */
export type CandleInterval =
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '8h'
  | '12h'
  | '1d'
  | '3d'
  | '1w'
  | '1M';

/** A validated Hyperliquid candle with numeric fields. */
export interface Candle {
  /** Candle open timestamp (ms). */
  time: number;
  /** Candle close timestamp (ms). A candle is closed when `closeTime <= now`. */
  closeTime: number;
  /** Full coin id as echoed by the API (preserved verbatim). */
  symbol: string;
  interval: CandleInterval;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Base-asset volume. */
  volume: number;
  /** Trade count. */
  trades: number;
}

/** Candle fetch result, distinguishing confirmed candles from the live
 *  provisional one. Only `closed` candles may feed signal scoring. */
export interface CandleSet {
  coin: FullCoinId;
  interval: CandleInterval;
  /** Confirmed closed candles (`closeTime <= now`), ascending by time. */
  closed: Candle[];
  /** The still-forming candle, if the API returned one. Display-only. */
  provisional: Candle | null;
  fetchedAt: number;
}
