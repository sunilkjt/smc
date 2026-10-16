import { describe, expect, it } from 'vitest';
import {
  classifyMarket,
  isStockCategory,
  normalizeCategory,
  splitCoinId,
} from './classification.ts';

describe('normalizeCategory', () => {
  it('lowercases and trims', () => {
    expect(normalizeCategory('  Stocks ')).toBe('stocks');
    expect(normalizeCategory('FX')).toBe('fx');
  });

  it('maps nullish values to empty string', () => {
    expect(normalizeCategory(null)).toBe('');
    expect(normalizeCategory(undefined)).toBe('');
  });
});

describe('isStockCategory', () => {
  it('accepts stocks/stock singular and plural, any case', () => {
    for (const label of ['stocks', 'STOCKS', 'Stocks', 'stock', 'Stock', 'equities', 'EQUITY']) {
      expect(isStockCategory(label)).toBe(true);
    }
  });

  it('rejects crypto, forex, commodities, indices and lookalikes', () => {
    for (const label of [
      'crypto',
      'FX',
      'fx',
      'commodities',
      'indices',
      'rates',
      'preipo',
      'stockish',
      'stocks ',
      '',
      null,
      undefined,
    ]) {
      // NOTE: 'stocks ' with a trailing space normalizes to 'stocks' and is
      // accepted — trailing whitespace is not meaningful. Assert accordingly.
      if (label === 'stocks ') {
        expect(isStockCategory(label)).toBe(true);
      } else {
        expect(isStockCategory(label)).toBe(false);
      }
    }
  });
});

describe('classifyMarket', () => {
  it('returns STOCK only for equity labels', () => {
    expect(classifyMarket('stocks')).toBe('STOCK');
    expect(classifyMarket('stock')).toBe('STOCK');
    expect(classifyMarket('indices')).toBe('UNKNOWN');
    expect(classifyMarket(undefined)).toBe('UNKNOWN');
  });
});

describe('splitCoinId', () => {
  it('splits HIP-3 identifiers on the first colon', () => {
    expect(splitCoinId('xyz:AAPL')).toEqual({ dex: 'xyz', coin: 'AAPL' });
    expect(splitCoinId('km:US500')).toEqual({ dex: 'km', coin: 'US500' });
  });

  it('treats unprefixed coins as main-dex markets', () => {
    expect(splitCoinId('BTC')).toEqual({ dex: '', coin: 'BTC' });
  });

  it('keeps extra colons inside the coin portion', () => {
    expect(splitCoinId('dex:A:B')).toEqual({ dex: 'dex', coin: 'A:B' });
  });
});
