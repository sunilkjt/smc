/**
 * Liquidity: resting levels from confirmed swings and equal highs/lows, plus
 * sweep detection with a strict confirmation rule.
 *
 * Rules:
 * - Every confirmed swing high is a buy-side level; every swing low is a
 *   sell-side level (`origin: "swing-high@<index>"`).
 * - Equal highs: two swing highs within `tolerance` (relative) are an
 *   `equal-highs@i,j` level at their mean (sell-side magnets above price are
 *   buy-side liquidity). Equal lows mirror.
 * - A TOUCH alone is never a sweep. A sweep requires, on a single candle:
 *     long sweep of a sell-side level L: low < L (wick pierces strictly) AND
 *     close > L (close back through strictly).
 *     short sweep of a buy-side level L: high > L AND close < L.
 * - Sweeps are searched causally over [0, asOfIndex] and only against levels
 *   created strictly before the sweeping candle.
 */
import type { Candle, LiquidityLevel, LiquiditySweep, SwingPoint } from '../types.ts';

/** Build resting levels from confirmed swings (causal as of `asOfIndex`). */
export function liquidityLevels(
  swings: SwingPoint[],
  asOfIndex: number,
  tolerance: number,
): LiquidityLevel[] {
  if (!(tolerance >= 0)) throw new Error('liquidityLevels: tolerance must be >= 0');
  const confirmed = swings.filter((s) => s.index <= asOfIndex);
  const levels: LiquidityLevel[] = confirmed.map((s) => ({
    price: s.price,
    side: s.side === 'high' ? 'buyside' : 'sellside',
    origin: s.side === 'high' ? `swing-high@${s.index}` : `swing-low@${s.index}`,
    createdIndex: s.index,
  }));
  const highs = confirmed.filter((s) => s.side === 'high');
  const lows = confirmed.filter((s) => s.side === 'low');
  const pair = (group: SwingPoint[], side: 'buyside' | 'sellside', tag: string): void => {
    for (let a = 0; a < group.length; a += 1) {
      for (let b = a + 1; b < group.length; b += 1) {
        const x = group[a];
        const y = group[b];
        if (!x || !y || x.price === 0) continue;
        if (Math.abs(x.price - y.price) / Math.abs(x.price) <= tolerance) {
          levels.push({
            price: (x.price + y.price) / 2,
            side,
            origin: `${tag}@${x.index},${y.index}`,
            createdIndex: Math.max(x.index, y.index),
          });
        }
      }
    }
  };
  pair(highs, 'buyside', 'equal-highs');
  pair(lows, 'sellside', 'equal-lows');
  return levels;
}

/**
 * Detect sweeps of `levels` over candles [0, asOfIndex]. Each level is swept
 * at most once (first qualifying candle wins); a level created at bar k can
 * only be swept by bars > k.
 */
export function detectSweeps(
  candles: Candle[],
  levels: LiquidityLevel[],
  asOfIndex: number,
): LiquiditySweep[] {
  const sweeps: LiquiditySweep[] = [];
  const swept = new Set<string>();
  for (let i = 0; i <= asOfIndex; i += 1) {
    const bar = candles[i];
    if (!bar) continue;
    for (const level of levels) {
      if (level.createdIndex >= i || swept.has(level.origin)) continue;
      if (level.side === 'sellside') {
        if (bar.low < level.price && bar.close > level.price) {
          swept.add(level.origin);
          sweeps.push({
            level,
            sweepIndex: i,
            sweepTime: bar.time,
            extreme: bar.low,
            close: bar.close,
          });
        }
      } else if (bar.high > level.price && bar.close < level.price) {
        swept.add(level.origin);
        sweeps.push({
          level,
          sweepIndex: i,
          sweepTime: bar.time,
          extreme: bar.high,
          close: bar.close,
        });
      }
    }
  }
  return sweeps;
}
