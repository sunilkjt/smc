import { describe, expect, it } from 'vitest';
import { assembleDiscovery, type DexMetaSnapshot } from './discovery.ts';

/** Minimal per-DEX snapshot fixtures: [main-dex, xyz-dex]. */
function fixtureDexMetas(): DexMetaSnapshot[] {
  return [
    {
      dex: '',
      dexDisplayName: 'Hyperliquid (main)',
      universe: [
        { name: 'BTC', szDecimals: 5, maxLeverage: 50 },
        { name: 'ETH', szDecimals: 4, maxLeverage: 50 },
      ],
      ctxs: [
        { markPx: '90000.0', dayNtlVlm: '100.0' },
        { markPx: '3000.0', dayNtlVlm: '50.0' },
      ],
    },
    {
      dex: 'xyz',
      dexDisplayName: 'XYZ',
      universe: [
        { name: 'xyz:AAPL', szDecimals: 3, maxLeverage: 20 },
        { name: 'xyz:NVDA', szDecimals: 3, maxLeverage: 20 },
        { name: 'xyz:GOLD', szDecimals: 4, maxLeverage: 25 },
        { name: 'xyz:OLD', szDecimals: 2, maxLeverage: 5, isDelisted: true },
        { name: 'xyz:MYSTERY', szDecimals: 2, maxLeverage: 5 },
      ],
      ctxs: [
        { markPx: '340.0', midPx: '340.1', dayNtlVlm: '500.0', openInterest: '10.0' },
        { markPx: '180.0', dayNtlVlm: '900.0' },
        { markPx: '2500.0', dayNtlVlm: '700.0' },
        { markPx: '1.0', dayNtlVlm: '1.0' },
        { markPx: '9.9', dayNtlVlm: '2.0' },
      ],
    },
  ];
}

function fixtureCategories(): Array<[string, string]> {
  return [
    ['xyz:AAPL', 'stocks'],
    ['xyz:NVDA', 'stocks'],
    ['xyz:GOLD', 'commodities'],
    // xyz:MYSTERY intentionally uncategorized -> UNKNOWN.
    // BTC/ETH intentionally uncategorized (main dex, crypto).
  ];
}

describe('assembleDiscovery', () => {
  it('keeps only verified stocks and preserves full identifiers', () => {
    const result = assembleDiscovery({
      dexMetas: fixtureDexMetas(),
      categories: fixtureCategories(),
      fetchedAt: 1234567890,
    });

    expect(result.markets.map((m) => m.id)).toEqual(['xyz:NVDA', 'xyz:AAPL']);
    expect(result.markets[0]?.dex).toBe('xyz');
    expect(result.markets[0]?.coin).toBe('NVDA');
    expect(result.markets[0]?.dexFullName).toBe('XYZ');
    expect(result.markets[0]?.classification).toBe('STOCK');
    expect(result.markets[0]?.markPx).toBe(180);
    expect(result.fetchedAt).toBe(1234567890);
  });

  it('sorts stocks by 24h notional descending', () => {
    const result = assembleDiscovery({
      dexMetas: fixtureDexMetas(),
      categories: fixtureCategories(),
      fetchedAt: 0,
    });
    const volumes = result.markets.map((m) => m.dayNtlVlm);
    expect(volumes).toEqual([900, 500]);
  });

  it('excludes delisted, non-equity and uncategorized assets with counts', () => {
    const result = assembleDiscovery({
      dexMetas: fixtureDexMetas(),
      categories: fixtureCategories(),
      fetchedAt: 0,
    });
    // BTC, ETH, xyz:GOLD, xyz:OLD (delisted), xyz:MYSTERY (no category)
    expect(result.excludedCount).toBe(5);
    expect(result.totalAssets).toBe(7);
    expect(result.dexCount).toBe(2);
    const reasons = Object.fromEntries(result.excludedSample.map((e) => [e.id, e.reason]));
    expect(reasons['xyz:OLD']).toBe('delisted');
    expect(reasons['xyz:GOLD']).toContain('commodities');
    expect(reasons['xyz:MYSTERY']).toContain('UNKNOWN');
  });

  it('returns an honest empty stock list when nothing verifies', () => {
    const result = assembleDiscovery({
      dexMetas: fixtureDexMetas(),
      categories: [],
      fetchedAt: 0,
    });
    expect(result.markets).toEqual([]);
    expect(result.excludedCount).toBe(7);
  });

  it('fails loudly on malformed universe entries instead of skipping them', () => {
    const broken = fixtureDexMetas();
    const main = broken[0];
    if (!main) throw new Error('fixture error');
    (main.universe as unknown[]).push({ name: 42 });
    expect(() =>
      assembleDiscovery({ dexMetas: broken, categories: fixtureCategories(), fetchedAt: 0 }),
    ).toThrow();
  });

  it('fails loudly when an asset prefix disagrees with its DEX snapshot', () => {
    const broken = fixtureDexMetas();
    const xyz = broken[1];
    if (!xyz) throw new Error('fixture error');
    (xyz.universe as Array<Record<string, unknown>>)[0] = {
      name: 'flx:AAPL',
      szDecimals: 3,
      maxLeverage: 20,
    };
    expect(() =>
      assembleDiscovery({ dexMetas: broken, categories: fixtureCategories(), fetchedAt: 0 }),
    ).toThrow(/prefix mismatch/);
  });
});
