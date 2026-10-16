/**
 * Headless market scan for scheduled runs (GitHub Actions) and debugging.
 * Reads REAL public API data; prints a summary and writes machine-readable
 * JSON for artifacts/alerts. No fake data, no fixtures.
 *
 * Env: TOP_N (default 8), OUT (default scan-results.json), TECH (1 to enable
 * the comparison strategy), MIN_RR (override engine minimum, default 2).
 * Exit 1 on any failure (never an empty "success").
 *
 * Cross-run persistence (PERSIST=1): loads prior signals + paper state from
 * Supabase, advances lifecycle over fresh candles, and writes everything
 * back — so scheduled runs continue history instead of starting blank.
 * Requires SUPABASE_URL (+VITE_SUPABASE_URL fallback) and
 * SUPABASE_SERVICE_ROLE_KEY (server-side only, never VITE_*, never committed).
 * Without them the scan still runs statelessly (artifact JSON only).
 *
 * Usage: npm run scan
 */
import { writeFileSync } from 'node:fs';
import { discoverStockMarkets } from '../src/lib/hyperliquid/index.ts';
import { DEFAULT_ENGINE_CONFIG, type ClosedTrade, type PaperAccount } from '../src/lib/types.ts';
import {
  DEFAULT_SCAN_OPTIONS,
  applyScan,
  evaluateMarket,
  fetchMarketCandles,
  type MarketScan,
  type ScanMarketPlan,
} from '../src/lib/scan.ts';
import { createAccount } from '../src/lib/paper/engine.ts';
import {
  loadAccount,
  loadSignals,
  loadTrades,
  recordScan,
  saveAccount,
  upsertSignals,
  upsertTrades,
  type SbConfig,
} from '../src/lib/supabase-sync.ts';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid ${name}=${raw}`);
  return n;
}

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${name}=${raw}`);
  return n;
}

function sbConfig(): SbConfig | null {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) return null;
  return { url, key };
}

function isClosedTrade(p: { status: string }): p is ClosedTrade {
  return p.status === 'closed';
}

async function main(): Promise<void> {
  const topN = Math.min(envInt('TOP_N', 8), 15);
  const out = process.env['OUT'] ?? 'scan-results.json';
  const techEnabled = process.env['TECH'] === '1';
  const minRR = Number(process.env['MIN_RR'] ?? DEFAULT_ENGINE_CONFIG.minRiskReward);
  if (!(minRR > 0)) throw new Error(`Invalid MIN_RR=${process.env['MIN_RR']}`);
  const engine = { ...DEFAULT_ENGINE_CONFIG, minRiskReward: minRR };
  const persist = process.env['PERSIST'] === '1';
  const sb = persist ? sbConfig() : null;
  if (persist && !sb) {
    throw new Error('PERSIST=1 requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }

  console.log(`Discovery + scan of top ${topN} verified stocks (tech=${techEnabled ? 'on' : 'off'}, persist=${sb ? 'supabase' : 'none'})`);
  const discovery = await discoverStockMarkets({ timeoutMs: 20000, maxRetries: 4 });
  console.log(
    `dexes=${discovery.dexCount} assets=${discovery.totalAssets} stocks=${discovery.markets.length} excluded=${discovery.excludedCount}`,
  );

  // Cross-run state (persist mode only).
  let priorIds = new Set<string>();
  let paper: PaperAccount | null = null;
  if (sb) {
    const { signals, skipped } = await loadSignals(sb);
    priorIds = new Set(signals.map((s) => s.id));
    const trades = await loadTrades(sb);
    const stored = await loadAccount(sb);
    const cfg = stored ?? {
      startingBalance: envNum('PAPER_START', 10_000),
      balance: envNum('PAPER_START', 10_000),
      riskPct: envNum('PAPER_RISK', 1),
      feeRate: 0.00045,
      slippageRate: 0.0002,
    };
    paper = {
      ...cfg,
      openPositions: trades.open,
      closedTrades: trades.closed.filter(isClosedTrade),
    };
    console.log(`loaded ${signals.length} signals, ${trades.open.length} open, ${trades.closed.length} closed (skipped ${skipped + trades.skipped} corrupt rows)`);
    // Stash for apply step.
    (globalThis as { __priorSignals?: unknown }).__priorSignals = signals;
  }

  const targets = discovery.markets.slice(0, topN);
  if (targets.length === 0) {
    console.log('EMPTY STATE: no verified stocks to scan.');
    writeFileSync(out, JSON.stringify({ scannedAt: Date.now(), signals: [], markets: [] }, null, 2));
    if (sb) {
      await recordScan(sb, {
        dexCount: discovery.dexCount, totalAssets: discovery.totalAssets,
        verifiedStocks: 0, excluded: discovery.excludedCount, signalsNew: 0, error: null,
      });
    }
    return;
  }

  const scannedAt = Date.now();
  const results: Array<{ coin: string; scan: MarketScan }> = [];
  const plans: ScanMarketPlan[] = [];
  let setups = 0;
  for (const market of targets) {
    try {
      const { context, setup } = await fetchMarketCandles(market.id, engine);
      plans.push({ market, context, setup, contextTf: engine.contextTimeframe, setupTf: engine.setupTimeframe });
      const scan = evaluateMarket(market.id, context, setup, {
        ...DEFAULT_SCAN_OPTIONS,
        engine,
        techEnabled,
      }, scannedAt);
      const tradable = scan.signals.filter((s) => s.state !== 'NO_TRADE');
      setups += tradable.length;
      console.log(
        `${market.id}: ${setup.length} setup bars → ${tradable.map((s) => `${s.direction}@${s.setup?.entry}`).join(', ') || 'NO_TRADE'}${scan.tech && scan.tech.direction !== 'none' ? ` | tech:${scan.tech.direction}` : ''}${scan.error ? ` ERROR:${scan.error}` : ''}`,
      );
      results.push({ coin: market.id, scan });
    } catch (err) {
      console.log(`${market.id}: FETCH FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`Tradable SMC setups: ${setups}`);

  const allSignals = results.flatMap((r) => r.scan.signals);
  if (sb) {
    const prior = ((globalThis as { __priorSignals?: unknown }).__priorSignals ?? []) as Parameters<typeof applyScan>[0];
    const applied = applyScan(prior, paper, plans, results.map((r) => r.scan), {
      ...DEFAULT_SCAN_OPTIONS, engine, techEnabled,
    }, scannedAt);
    const newIds = applied.signals.filter((s) => !priorIds.has(s.id));
    await upsertSignals(sb, applied.signals);
    await upsertTrades(sb, [...applied.paper.openPositions, ...applied.paper.closedTrades]);
    await saveAccount(sb, applied.paper);
    await recordScan(sb, {
      dexCount: discovery.dexCount, totalAssets: discovery.totalAssets,
      verifiedStocks: discovery.markets.length, excluded: discovery.excludedCount,
      signalsNew: newIds.length, error: null,
    });
    console.log(`persisted ${applied.signals.length} signals (${newIds.length} new), ${applied.paper.openPositions.length} open, ${applied.paper.closedTrades.length} closed`);
    writeFileSync(out, JSON.stringify({ scannedAt, signals: applied.signals, markets: results.map((r) => ({ coin: r.coin, error: r.scan.error })) }, null, 2));
  } else {
    writeFileSync(out, JSON.stringify({ scannedAt, signals: allSignals, markets: results.map((r) => ({ coin: r.coin, error: r.scan.error })) }, null, 2));
  }
  console.log(`Wrote ${out}`);
}

main().catch((err: unknown) => {
  console.error(`SCAN FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
