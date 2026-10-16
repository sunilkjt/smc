/**
 * Stable signal IDs for duplicate prevention.
 *
 * Format: `smc:<coin>:<setupTf>:<long|short>:<setupBarTime>:<hash>` where
 * `<hash>` is FNV-1a over the setup's defining numbers (rounded to 6dp).
 * The same market re-scanned with identical confirmation produces the same
 * id; any change in entry/stop/targets produces a new one. No randomness,
 * no timestamps from wall-clock — ids are content-derived.
 */
import type { SmcSetup, StrategyId } from '../types.ts';

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function stableSignalId(strategy: StrategyId, setup: SmcSetup): string {
  const nums = [
    setup.entry,
    setup.stopLoss,
    setup.takeProfit1,
    setup.takeProfit2,
    setup.setupIndex,
  ]
    .map((n) => n.toFixed(6))
    .join('|');
  return [
    strategy,
    setup.coin,
    setup.setupTimeframe,
    setup.direction,
    String(setup.signalTime),
    fnv1a(`${setup.coin}|${setup.direction}|${nums}`),
  ].join(':');
}
