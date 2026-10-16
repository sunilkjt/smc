/**
 * Display-only SMC chart overlays, computed from confirmed closed candles.
 *
 * These annotations EXPLAIN past price action on the chart; they never feed
 * signal scoring (the engine in smc/setup.ts does that with its own config).
 * Everything here is causal: markers sit on the confirming bar, zones reflect
 * open/partial FVGs and non-invalidated order blocks. Counts are capped so
 * busy charts stay readable — most recent first.
 */
import type { Candle, OrderBlock } from '../types.ts';
import { detectFvgs } from './fvg.ts';
import { detectSweeps, liquidityLevels } from './liquidity.ts';
import { analyzeStructure } from './structure.ts';
import { findSwings } from './swings.ts';
import { orderBlockForBreak, resolveOrderBlock } from './orderblocks.ts';

export interface OverlayMarker {
  time: number;
  position: 'aboveBar' | 'belowBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  text: string;
}

export interface OverlayZone {
  top: number;
  bottom: number;
  color: string;
  title: string;
}

export interface OverlaySelection {
  structure: boolean;
  sweeps: boolean;
  zones: boolean;
}

const MAX_MARKERS = 40;
const MAX_ZONES = 8;

export function buildSmcOverlays(
  candles: Candle[],
  selection: OverlaySelection,
  strength = 2,
  tolerance = 0.001,
): { markers: OverlayMarker[]; zones: OverlayZone[] } {
  const markers: OverlayMarker[] = [];
  const zones: OverlayZone[] = [];
  if (candles.length === 0) return { markers, zones };
  const end = candles.length - 1;

  const swings = findSwings(candles, strength, end);
  const structure = analyzeStructure(candles, swings, end);
  const levels = liquidityLevels(swings, end, tolerance);
  const sweeps = detectSweeps(candles, levels, end);

  if (selection.structure) {
    for (const e of structure.events.slice(-MAX_MARKERS)) {
      const bull = e.type === 'BOS_BULL' || e.type === 'CHOCH_BULL';
      markers.push({
        time: e.time,
        position: bull ? 'belowBar' : 'aboveBar',
        color: e.type.startsWith('BOS') ? '#22c07a' : '#d9a441',
        shape: bull ? 'arrowUp' : 'arrowDown',
        text: e.type.startsWith('BOS') ? 'BOS' : 'CHoCH',
      });
    }
  }

  if (selection.sweeps) {
    for (const s of sweeps.slice(-MAX_MARKERS)) {
      const sell = s.level.side === 'sellside';
      markers.push({
        time: s.sweepTime,
        position: sell ? 'belowBar' : 'aboveBar',
        color: '#5aa9ff',
        shape: 'square',
        text: 'SWEEP',
      });
    }
  }

  if (selection.zones) {
    const gaps = detectFvgs(candles, end);
    for (const g of gaps.filter((x) => x.status === 'open' || x.status === 'partial').slice(-MAX_ZONES)) {
      zones.push({
        top: g.top,
        bottom: g.bottom,
        color: 'rgba(34,192,122,0.55)',
        title: g.direction === 'bullish' ? 'FVG+' : 'FVG-',
      });
    }
    const blocks: OrderBlock[] = [];
    for (const e of structure.events.slice(-6)) {
      const ob = orderBlockForBreak(candles, e, strength * 5 + 5);
      if (!ob) continue;
      resolveOrderBlock(candles, ob, end);
      if (!ob.invalidated) blocks.push(ob);
    }
    for (const ob of blocks.slice(-MAX_ZONES)) {
      zones.push({
        top: ob.top,
        bottom: ob.bottom,
        color: 'rgba(167,139,250,0.55)',
        title: ob.direction === 'bullish' ? 'OB+' : 'OB-',
      });
    }
  }

  markers.sort((a, b) => a.time - b.time);
  return { markers: markers.slice(-MAX_MARKERS), zones };
}
