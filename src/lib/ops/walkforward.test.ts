import { describe, expect, it } from 'vitest';
import {
  buildCutoffs,
  replayCutoff,
  sliceAtOrBefore,
  WF_FORWARD_BARS,
} from './walkforward.ts';
import { DEFAULT_ENGINE_CONFIG, type Candle } from '../types.ts';

function bar(time: number, close: number, spread = 0.5): Candle {
  return {
    time,
    closeTime: time + 899_999,
    symbol: 'T',
    interval: '15m',
    open: close,
    high: close + spread,
    low: close - spread,
    close,
    volume: 10,
    trades: 5,
  };
}

describe('buildCutoffs / sliceAtOrBefore', () => {
  it('builds fixed grids ending at the span end', () => {
    expect(buildCutoffs(1_000, 100, 3)).toEqual([800, 900, 1000]);
    expect(() => buildCutoffs(1_000, 100, 0)).toThrow();
  });

  it('slices causally (nothing past the cutoff leaks in)', () => {
    const bars = [bar(0, 1), bar(900_000, 2), bar(1_800_000, 3)];
    const sliced = sliceAtOrBefore(bars, 900_000 + 899_999);
    expect(sliced.map((b) => b.close)).toEqual([1, 2]);
  });
});

describe('replayCutoff', () => {
  it('returns empty (not fabricated) on insufficient history', () => {
    const few = [bar(0, 100), bar(900_000, 101)];
    const out = replayCutoff('x', few, few, 2_000_000, DEFAULT_ENGINE_CONFIG, 9);
    expect(out).toMatchObject({ setups: 0, filled: 0, trades: [], openLeft: 0 });
  });

  it('is deterministic: identical inputs give identical outcomes', () => {
    // Flat history: no structure can confirm, so the honest answer is empty —
    // deterministically empty on repeat runs.
    const flat: Candle[] = Array.from({ length: 300 }, (_, i) => bar(i * 900_000, 100));
    const ctx: Candle[] = Array.from({ length: 150 }, (_, i) => bar(i * 3_600_000, 100));
    const cutoff = flat[flat.length - 1]?.closeTime ?? 0;
    const a = replayCutoff('x', flat, ctx, cutoff, DEFAULT_ENGINE_CONFIG, 9);
    const b = replayCutoff('x', flat, ctx, cutoff, DEFAULT_ENGINE_CONFIG, 9);
    expect(a).toEqual(b);
    expect(a.setups).toBe(0);
  });

  it('explains empty windows with first-failure reasons (flat tape → HTF context)', () => {
    const flat: Candle[] = Array.from({ length: 300 }, (_, i) => bar(i * 900_000, 100));
    const ctx: Candle[] = Array.from({ length: 150 }, (_, i) => bar(i * 3_600_000, 100));
    const cutoff = flat[flat.length - 1]?.closeTime ?? 0;
    const out = replayCutoff('x', flat, ctx, cutoff, DEFAULT_ENGINE_CONFIG, 9);
    expect(out.reasons).toEqual(['NO_HTF_CONTEXT', 'NO_HTF_CONTEXT']);
  });

  it('caps the forward window (bounded resolution horizon)', () => {
    expect(WF_FORWARD_BARS).toBe(500);
  });
});
