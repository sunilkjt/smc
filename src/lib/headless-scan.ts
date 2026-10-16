/**
 * Reusable headless scan core: discovery → top-N candle fetch → SMC (+tech)
 * evaluation → optional Supabase persistence with lifecycle advancement.
 * Shared by the `npm run scan` CLI and the Telegram command poller.
 * Reads REAL public API data only; throws on failure (never empty success).
 */
import { discoverStockMarkets } from './hyperliquid/index.ts';
import {
  DEFAULT_ENGINE_CONFIG,
  type ClosedTrade,
  type DiscoveryResult,
  type PaperAccount,
  type PaperPosition,
} from './types.ts';
import {
  DEFAULT_SCAN_OPTIONS,
  applyScan,
  evaluateMarket,
  fetchMarketCandles,
  type MarketScan,
  type ScanMarketPlan,
} from './scan.ts';
import { createAccount } from './paper/engine.ts';
import {
  loadAccount,
  loadSignals,
  loadTrades,
  recordScan,
  saveAccount,
  upsertSignals,
  upsertTrades,
  validateSbConfig,
  type SbConfig,
} from './supabase-sync.ts';

export interface HeadlessOptions {
  topN: number;
  techEnabled: boolean;
  minRR: number;
  /** Supabase persist mode; null = stateless run. */
  sb: SbConfig | null;
  paperStart: number;
  paperRisk: number;
  onLog?: (message: string) => void;
}

export interface HeadlessMarketResult {
  coin: string;
  scan: MarketScan;
}

export interface HeadlessResult {
  scannedAt: number;
  discovery: DiscoveryResult;
  results: HeadlessMarketResult[];
  tradableCount: number;
  persisted: {
    signalCount: number;
    newCount: number;
    openCount: number;
    closedCount: number;
  } | null;
}

function isClosedTrade(p: PaperPosition): p is ClosedTrade {
  return p.status === 'closed';
}

export async function runHeadlessScan(opts: HeadlessOptions): Promise<HeadlessResult> {
  const log = opts.onLog ?? (() => {});
  const topN = Math.min(Math.max(1, Math.floor(opts.topN)), 15);
  if (!(opts.minRR > 0)) throw new Error(`Invalid minRR=${opts.minRR}`);
  const engine = { ...DEFAULT_ENGINE_CONFIG, minRiskReward: opts.minRR };
  if (opts.sb) validateSbConfig(opts.sb);

  // Scheduled runners share egress IPs and hit 429s often: generous retries.
  const discovery = await discoverStockMarkets({ timeoutMs: 25000, maxRetries: 6 });
  log(
    `dexes=${discovery.dexCount} assets=${discovery.totalAssets} stocks=${discovery.markets.length} excluded=${discovery.excludedCount}`,
  );

  let priorSignals: Awaited<ReturnType<typeof loadSignals>>['signals'] = [];
  let paper: PaperAccount | null = null;
  if (opts.sb) {
    const loaded = await loadSignals(opts.sb);
    priorSignals = loaded.signals;
    const trades = await loadTrades(opts.sb);
    const stored = await loadAccount(opts.sb);
    const cfg = stored ?? {
      startingBalance: opts.paperStart,
      balance: opts.paperStart,
      riskPct: opts.paperRisk,
      feeRate: 0.00045,
      slippageRate: 0.0002,
    };
    paper = {
      ...cfg,
      openPositions: trades.open,
      closedTrades: trades.closed.filter(isClosedTrade),
    };
    log(`loaded ${priorSignals.length} signals, ${trades.open.length} open, ${trades.closed.length} closed`);
  } else {
    paper = createAccount({ startingBalance: opts.paperStart, riskPct: opts.paperRisk });
  }

  const targets = discovery.markets.slice(0, topN);
  const scannedAt = Date.now();
  const results: HeadlessMarketResult[] = [];
  const plans: ScanMarketPlan[] = [];
  let tradableCount = 0;
  for (const market of targets) {
    try {
      const { context, setup } = await fetchMarketCandles(market.id, engine);
      plans.push({ market, context, setup, contextTf: engine.contextTimeframe, setupTf: engine.setupTimeframe });
      const scan = evaluateMarket(market.id, context, setup, {
        ...DEFAULT_SCAN_OPTIONS,
        engine,
        techEnabled: opts.techEnabled,
      }, scannedAt);
      const tradable = scan.signals.filter((s) => s.state !== 'NO_TRADE');
      tradableCount += tradable.length;
      log(
        `${market.id}: ${setup.length} setup bars → ${tradable.map((s) => `${s.direction}@${s.setup?.entry}`).join(', ') || 'NO_TRADE'}${scan.tech && scan.tech.direction !== 'none' ? ` | tech:${scan.tech.direction}` : ''}${scan.error ? ` ERROR:${scan.error}` : ''}`,
      );
      results.push({ coin: market.id, scan });
    } catch (err) {
      log(`${market.id}: FETCH FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let persisted: HeadlessResult['persisted'] = null;
  if (opts.sb) {
    const sb = opts.sb;
    const priorIds = new Set(priorSignals.map((s) => s.id));
    const applied = applyScan(priorSignals, paper, plans, results.map((r) => r.scan), {
      ...DEFAULT_SCAN_OPTIONS, engine, techEnabled: opts.techEnabled,
    }, scannedAt);
    const newCount = applied.signals.filter((s) => !priorIds.has(s.id)).length;
    await upsertSignals(sb, applied.signals);
    await upsertTrades(sb, [...applied.paper.openPositions, ...applied.paper.closedTrades]);
    await saveAccount(sb, applied.paper);
    await recordScan(sb, {
      dexCount: discovery.dexCount, totalAssets: discovery.totalAssets,
      verifiedStocks: discovery.markets.length, excluded: discovery.excludedCount,
      signalsNew: newCount, error: null,
    });
    persisted = {
      signalCount: applied.signals.length,
      newCount,
      openCount: applied.paper.openPositions.length,
      closedCount: applied.paper.closedTrades.length,
    };
    log(`persisted ${persisted.signalCount} signals (${newCount} new), ${persisted.openCount} open, ${persisted.closedCount} closed`);
  }
  return { scannedAt, discovery, results, tradableCount, persisted };
}
