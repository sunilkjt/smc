/**
 * Hyperliquid market-data adapter — public surface.
 * Phase 3: discovery, classification, candles. (SMC, signals and paper
 * trading arrive in later phases as sibling `src/lib/*` modules.)
 */

export {
  HyperliquidError,
  apiSemaphore,
  postInfo,
  resolveApiBase,
  Semaphore,
  DEFAULT_HL_API_BASE,
  type HyperliquidErrorKind,
  type PostInfoOptions,
} from './client.ts';
export {
  classifyMarket,
  isStockCategory,
  normalizeCategory,
  splitCoinId,
} from './classification.ts';
export {
  assembleDiscovery,
  discoverStockMarkets,
  type AssembleInputs,
  type DexMetaSnapshot,
  type RawAssetCtx,
  type RawUniverseEntry,
} from './discovery.ts';
export {
  alignToCandleOpen,
  CANDLE_INTERVALS,
  fetchCandles,
  INTERVAL_MS,
  intervalMs,
  parseCandle,
  parseCandles,
  selectClosedCandles,
  splitProvisional,
  type FetchCandlesOptions,
} from './candles.ts';
