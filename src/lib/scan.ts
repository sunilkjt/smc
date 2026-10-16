/**
 * Scan orchestration shared by the UI and the headless scheduled scan.
 *
 * One scan = discovery (verified stocks) → top-N by 24h notional → per-market
 * context+setup candle fetch (sequential, rate-limit friendly) → SMC signals
 * for both directions (+ optional Tech evaluation) → lifecycle advancement
 * over the freshly fetched forward bars → paper fill/resolution.
 *
 * Weight budget (approx): discovery ≈13 calls ≈ 280 weight; each market
 * 2 candle calls ≈ 50 weight. Default topN=8 → ≈ 680 total, inside the
 * 1200/min/IP budget when run sequentially. Forward visibility is limited to
 * the fetched window — signals resolve across repeated scans, honestly.
 */
import { fetchCandles } from './hyperliquid/candles.ts';
import { INTERVAL_MS } from './hyperliquid/candles.ts';
import type {
  Candle,
  EngineConfig,
  Market,
  PaperAccount,
  Signal,
} from './types.ts';
import { DEFAULT_ENGINE_CONFIG } from './types.ts';
import { ingestScan, scanDirections } from './signals/engine.ts';
import { advanceSignal } from './signals/lifecycle.ts';
import { openFromSignal, resolvePositions, createAccount } from './paper/engine.ts';
import { evaluateTech, techSignalFromEvaluation, type TechEvaluation } from './tech/strategy.ts';

export interface ScanMarketPlan {
  market: Market;
  context: Candle[];
  setup: Candle[];
  contextTf: EngineConfig['contextTimeframe'];
  setupTf: EngineConfig['setupTimeframe'];
}

export interface ScanOptions {
  topN: number;
  engine: EngineConfig;
  techEnabled: boolean;
}

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  topN: 8,
  engine: DEFAULT_ENGINE_CONFIG,
  techEnabled: false,
};

/** Fetch one market's context+setup candles (sequential caller-side). */
export async function fetchMarketCandles(
  coin: Market['id'],
  engine: EngineConfig,
): Promise<{ context: Candle[]; setup: Candle[]; fetchedAt: number }> {
  const now = Date.now();
  const ctxMs = INTERVAL_MS[engine.contextTimeframe];
  const setupMs = INTERVAL_MS[engine.setupTimeframe];
  const ctxCount = 130;
  const setupCount = 260;
  const context = await fetchCandles(
    coin,
    engine.contextTimeframe,
    now - ctxCount * ctxMs,
    now,
    { now },
  );
  const setup = await fetchCandles(
    coin,
    engine.setupTimeframe,
    now - setupCount * setupMs,
    now,
    { now },
  );
  return { context: context.closed, setup: setup.closed, fetchedAt: now };
}

export interface MarketScan {
  coin: string;
  signals: Signal[];
  tech: TechEvaluation | null;
  setupBars: number;
  error: string | null;
}

/** Evaluate one market's fetched candles (pure, no IO). */
export function evaluateMarket(
  coin: string,
  context: Candle[],
  setup: Candle[],
  opts: ScanOptions,
  scannedAt: number,
): MarketScan {
  try {
    const signals = scanDirections({
      coin,
      context,
      setup,
      config: opts.engine,
      dataNow: scannedAt,
      scannedAt,
    });
    let tech: TechEvaluation | null = null;
    if (opts.techEnabled && setup.length > 0) {
      tech = evaluateTech({ coin, candles: setup, htf: context });
      const last = setup[setup.length - 1];
      if (tech.direction !== 'none' && last) {
        const techSignal = techSignalFromEvaluation(
          coin,
          tech,
          opts.engine.setupTimeframe,
          setup.length - 1,
          last.closeTime,
          last.closeTime,
          scannedAt,
        );
        if (techSignal) signals.push(techSignal);
      }
      // A "no confluence" outcome is intentionally silent: the SMC
      // diagnostics already cover the coin, and dashboards stay clean.
    }
    return { coin, signals, tech, setupBars: setup.length, error: null };
  } catch (err) {
    return {
      coin,
      signals: [],
      tech: null,
      setupBars: setup.length,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface ApplyScanResult {
  signals: Signal[];
  paper: PaperAccount;
  scanned: MarketScan[];
}

/**
 * Merge scan output into the stored state: ingest (dedupe), advance every
 * stored signal for the scanned coins over the fresh forward bars, open paper
 * positions for newly ACTIVE signals, and resolve open positions.
 */
export function applyScan(
  previousSignals: Signal[],
  paper: PaperAccount | null,
  plans: ScanMarketPlan[],
  scans: MarketScan[],
  opts: ScanOptions,
  scannedAt: number,
): ApplyScanResult {
  const fresh = scans.flatMap((s) => s.signals);
  let signals = ingestScan(previousSignals, fresh);
  let account = paper ?? createAccount();

  const setupByCoin = new Map(plans.map((p) => [p.market.id, p.setup]));
  // Advance stored signals that belong to scanned coins.
  signals = signals.map((s) => {
    const setup = s.setup;
    if (setup == null) return s;
    const setupBars = setupByCoin.get(s.coin);
    if (!setupBars) return s;
    const forward = setupBars.filter((c) => c.closeTime > setup.signalTime);
    if (forward.length === 0) return s;
    return advanceSignal(s, { candles: forward, barMs: INTERVAL_MS[s.setupTimeframe] }, opts.engine);
  });

  // Open paper positions for ACTIVE setup signals without one, then resolve.
  for (const s of signals) {
    if (s.state !== 'ACTIVE' || s.setup == null) continue;
    const res = openFromSignal(account, s, s.entryFilledAt ?? scannedAt);
    account = res.account;
  }
  for (const plan of plans) {
    const forward = plan.setup; // resolvePositions skips bars ≤ openedAt itself
    account = resolvePositions(account, forward);
  }
  return { signals, paper: account, scanned: scans };
}
