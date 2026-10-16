/**
 * Live smoke test: reads REAL public Hyperliquid market data and reports the
 * discovered, verified equity markets. No fake data, no fallback, no fixtures.
 *
 * Exit codes:
 *   0 — scan completed (even with zero verified stocks; that is reported as
 *       an honest empty state, per spec).
 *   1 — network failure, response-shape failure, or any unexpected error.
 *       Failures are never converted into empty successful results.
 *
 * Usage: npm run smoke:discovery
 */
import { discoverStockMarkets, fetchCandles } from '../src/lib/hyperliquid/index.ts';

function fmt(n: number | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

async function main(): Promise<void> {
  console.log('Hyperliquid SMC Stocks — live discovery smoke test');
  console.log('==================================================');

  const started = Date.now();
  const result = await discoverStockMarkets({ timeoutMs: 20000, maxRetries: 4 });
  console.log(`scan completed in ${Date.now() - started}ms`);
  console.log(`perp DEXes observed : ${result.dexCount}`);
  console.log(`total assets seen   : ${result.totalAssets}`);
  console.log(`verified STOCKS     : ${result.markets.length}`);
  console.log(`excluded            : ${result.excludedCount}`);

  if (result.markets.length === 0) {
    console.log('');
    console.log('EMPTY STATE: no markets meet the stock-verification criteria right now.');
    console.log('Excluded sample:');
    for (const e of result.excludedSample) console.log(`  - ${e.id}: ${e.reason}`);
    return;
  }

  console.log('');
  console.log('Top verified stocks by 24h notional:');
  for (const m of result.markets.slice(0, 15)) {
    console.log(
      `  - ${m.id}  mark=${fmt(m.markPx)}  24h=${fmt(m.dayNtlVlm, 0)}  lev=${m.maxLeverage}x` +
        (m.dexFullName ? `  dex=${m.dexFullName}` : ''),
    );
  }

  // Prove candle retrieval works end-to-end for a real verified stock,
  // preserving the exact full identifier (HIP-3 prefix included).
  const probe = result.markets.find((m) => m.id === 'xyz:AAPL') ?? result.markets[0];
  if (!probe) throw new Error('unreachable: markets list was non-empty');
  const now = Date.now();
  const candles = await fetchCandles(probe.id, '1h', now - 48 * 3600_000, now, {
    timeoutMs: 20000,
    maxRetries: 4,
    now,
  });
  console.log('');
  console.log(`Candle probe: ${candles.coin} 1h / 48h`);
  console.log(`  confirmed closed : ${candles.closed.length}`);
  console.log(
    `  provisional      : ${candles.provisional ? String(candles.provisional.close) : 'none'}`,
  );
  const last = candles.closed[candles.closed.length - 1];
  if (last) {
    console.log(`  last close       : ${fmt(last.close)} @ ${new Date(last.time).toISOString()}`);
  } else {
    console.log('  NOTE: empty window (sparse trading) — treated as no-data, not zero volume.');
  }
  if (candles.closed.length === 0) {
    console.log('  WARNING: probe returned no confirmed candles; data may be sparse right now.');
  }
}

main().catch((err: unknown) => {
  console.error(`SMOKE FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
