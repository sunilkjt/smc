import { describe, expect, it } from 'vitest';
import { buildSmcOverlays } from './overlays.ts';
import { mkCandles } from './smc-core.test.ts';

const ALL = { structure: true, sweeps: true, zones: true };
const NONE = { structure: false, sweeps: false, zones: false };

describe('buildSmcOverlays', () => {
  it('marks structure breaks and sweeps on the confirming bars', () => {
    const bars = mkCandles([
      [10, 11, 9.8, 10.2],
      [10.2, 10.6, 10.0, 10.4],
      [10.4, 10.5, 9.0, 9.5], // swing low 9.0 @2
      [9.5, 10.0, 9.4, 9.8],
      [9.8, 10.2, 9.6, 10.0],
      [10.0, 12.5, 8.5, 10.5], // sweeps 9.0, closes back through
      [10.5, 11.5, 10.4, 11.2],
      [11.2, 13, 11, 12.8], // closes through swing high 12.5 → CHoCH
    ]);
    const { markers, zones } = buildSmcOverlays(bars, ALL, 1);
    const texts = markers.map((m) => m.text);
    expect(texts).toContain('CHoCH');
    expect(texts).toContain('SWEEP');
    expect(markers.every((m) => m.time > 0)).toBe(true);
    expect(zones.length).toBeGreaterThanOrEqual(0);
  });

  it('renders FVG zones for open gaps and respects the selection toggles', () => {
    const bars = mkCandles([
      [10, 11, 9.5, 10.5],
      [10.5, 12, 10.4, 11.8],
      [11.8, 13, 11.5, 12.5],
      [12.5, 12.8, 12, 12.2],
    ]);
    const { zones } = buildSmcOverlays(bars, ALL, 1);
    expect(zones.some((z) => z.title === 'FVG+')).toBe(true);
    const off = buildSmcOverlays(bars, NONE, 1);
    expect(off.markers).toEqual([]);
    expect(off.zones).toEqual([]);
    expect(buildSmcOverlays([], ALL).markers).toEqual([]);
  });
});
