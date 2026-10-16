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

/* ------------------------------------------------------------------ */
/* SMC primitives                                                      */
/* ------------------------------------------------------------------ */

export type TrendDirection = 'bullish' | 'bearish' | 'neutral';

/** A confirmed swing high/low. `confirmedAt` is the close time of the last
 *  confirmation candle — nothing after it was used to detect the swing. */
export interface SwingPoint {
  index: number;
  time: number;
  price: number;
  side: 'high' | 'low';
  /** Close time of the final confirmation bar (causal availability). */
  confirmedAt: number;
}

export type StructureEventType = 'BOS_BULL' | 'BOS_BEAR' | 'CHOCH_BULL' | 'CHOCH_BEAR';

export interface StructureEvent {
  type: StructureEventType;
  /** Index of the breaking (closing) candle. */
  index: number;
  time: number;
  /** The broken swing price. */
  level: number;
  /** Close price of the breaking candle. */
  close: number;
}

/** Buy-side (above) or sell-side (below) resting liquidity. */
export interface LiquidityLevel {
  price: number;
  side: 'buyside' | 'sellside';
  /** Origin description, e.g. "swing-high@12" or "equal-highs@7,9". */
  origin: string;
  /** Index of the bar that created the level. */
  createdIndex: number;
}

export interface LiquiditySweep {
  level: LiquidityLevel;
  /** Index of the sweeping candle (wick pierced, close returned). */
  sweepIndex: number;
  sweepTime: number;
  extreme: number;
  close: number;
}

export type FvgStatus = 'open' | 'partial' | 'filled' | 'invalidated';

export interface FairValueGap {
  direction: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  /** Index of the third (confirming) candle. */
  createdIndex: number;
  createdTime: number;
  status: FvgStatus;
  /** Index where status last changed (`null` while open). */
  resolvedIndex: number | null;
}

export interface OrderBlock {
  direction: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  /** Index of the order-block candle itself. */
  index: number;
  createdTime: number;
  /** The structure-break index that qualifies this block. */
  breakIndex: number;
  mitigated: boolean;
  invalidated: boolean;
}

export interface DealingRange {
  high: number;
  low: number;
  equilibrium: number;
}

/* ------------------------------------------------------------------ */
/* Setups and signals                                                  */
/* ------------------------------------------------------------------ */

export type SignalDirection = 'long' | 'short';

export interface SetupCondition {
  name: string;
  passed: boolean;
  detail: string;
}

/** A validated multi-timeframe SMC setup with defined risk. */
export interface SmcSetup {
  coin: FullCoinId;
  contextTimeframe: CandleInterval;
  setupTimeframe: CandleInterval;
  entryTimeframe: CandleInterval;
  direction: SignalDirection;
  /** Conservative limit entry (zone edge nearest the market). */
  entry: number;
  entryZoneTop: number;
  entryZoneBottom: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskReward1: number;
  riskReward2: number;
  /** Index/time of the setup-TF confirmation bar. `signalTime` is its close. */
  setupIndex: number;
  signalTime: number;
  dataTime: number;
  conditions: SetupCondition[];
  qualityPassed: number;
  qualityTotal: number;
  explanation: string;
  /** Candidate entry-zone sources, e.g. ["bullish-FVG@i","bullish-OB@j"]. */
  zoneSources: string[];
}

export type NoTradeReason =
  | 'STALE_OR_MISSING_DATA'
  | 'NO_HTF_CONTEXT'
  | 'NO_LIQUIDITY_EVENT'
  | 'NO_STRUCTURE_SHIFT'
  | 'NO_ENTRY_ZONE'
  | 'RR_TOO_LOW'
  | 'TARGET_TOO_CLOSE'
  | 'STOP_INVALID'
  | 'ENTRY_INVALIDATED';

export type StrategyId = 'smc' | 'tech';

export type SignalState =
  | 'NO_TRADE'
  | 'WAITING_FOR_SETUP'
  | 'WAITING_FOR_RETEST'
  | 'ACTIVE'
  | 'INVALIDATED'
  | 'EXPIRED'
  | 'RESOLVED';

export interface Signal {
  /** Stable id: strategy:coin:tf:dir:setupTime:hash — dedupe key. */
  id: string;
  strategy: StrategyId;
  coin: FullCoinId;
  setupTimeframe: CandleInterval;
  direction: SignalDirection;
  state: SignalState;
  setup: SmcSetup | null;
  noTradeReason: NoTradeReason | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
  /** Forward-resolution bookkeeping. */
  entryFilledAt: number | null;
  resolvedAt: number | null;
  resolution: string | null;
}

export interface SignalOutcome {
  signalId: string;
  strategy: StrategyId;
  coin: FullCoinId;
  direction: SignalDirection;
  entry: number;
  stopLoss: number;
  exit: number;
  exitReason: 'TP1' | 'TP2' | 'STOP' | 'EXPIRED' | 'INVALIDATED';
  realizedR: number;
  pnl: number;
  fees: number;
  openedAt: number;
  closedAt: number;
}

/* ------------------------------------------------------------------ */
/* Paper trading                                                       */
/* ------------------------------------------------------------------ */

export interface PaperPosition {
  id: string;
  signalId: string;
  strategy: StrategyId;
  coin: FullCoinId;
  direction: SignalDirection;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  size: number;
  riskAmount: number;
  openedAt: number;
  status: 'open' | 'closed';
  /** Partial TP1 handling: fraction closed at TP1 (0 or 0.5). */
  tp1Taken: boolean;
  exitPrice: number | null;
  exitReason: 'TP1' | 'TP2' | 'STOP' | 'EXPIRED' | 'INVALIDATED' | null;
  closedAt: number | null;
  realizedPnl: number | null;
  realizedR: number | null;
  fees: number;
}

export interface ClosedTrade extends PaperPosition {
  status: 'closed';
  exitPrice: number;
  exitReason: 'TP1' | 'TP2' | 'STOP' | 'EXPIRED' | 'INVALIDATED';
  closedAt: number;
  realizedPnl: number;
  realizedR: number;
}

export interface PaperAccount {
  startingBalance: number;
  balance: number;
  riskPct: number;
  feeRate: number;
  slippageRate: number;
  openPositions: PaperPosition[];
  closedTrades: ClosedTrade[];
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

export interface PerformanceMetrics {
  signals: number;
  activated: number;
  completed: number;
  wins: number;
  losses: number;
  winRate: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  averageR: number | null;
  maxDrawdownR: number | null;
  totalR: number;
  /** True when the sample is too small for conclusions. */
  smallSample: boolean;
}

export interface EngineConfig {
  swingStrength: number;
  equalTolerance: number;
  sweepLookback: number;
  fvgLookback: number;
  structureLookback: number;
  signalExpiryBars: number;
  minRiskReward: number;
  atrPeriod: number;
  atrStopBuffer: number;
  minTargetAtrMultiple: number;
  contextTimeframe: CandleInterval;
  setupTimeframe: CandleInterval;
  entryTimeframe: CandleInterval;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  swingStrength: 2,
  equalTolerance: 0.001,
  sweepLookback: 30,
  fvgLookback: 30,
  structureLookback: 60,
  signalExpiryBars: 48,
  minRiskReward: 2,
  atrPeriod: 14,
  atrStopBuffer: 0.25,
  minTargetAtrMultiple: 0.5,
  contextTimeframe: '1h',
  setupTimeframe: '15m',
  entryTimeframe: '5m',
};
