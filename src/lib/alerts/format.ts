/**
 * Telegram alert message formatting + send gating.
 *
 * - `formatSignalAlert` renders entry, stop, targets, RR, signal time and a
 *   strategy tag. Pure and tested.
 * - `shouldSendAlert` gates delivery: tradable states only, fresh data only,
 *   strategy/market allowlists, and id dedupe. An alerting failure must never
 *   alter signal outcomes — dispatch (scripts/send-telegram.ts) only reads.
 * - Credentials stay server-side (Actions secrets / host env). The browser
 *   never holds the bot token.
 */
import type { Signal } from '../types.ts';

export interface AlertFilter {
  strategies: Array<'smc' | 'tech'>;
  /** Empty = all verified markets. Full `dex:COIN` ids. */
  coins: string[];
  minQuality: number;
}

export function formatSignalAlert(signal: Signal): string | null {
  if (signal.setup == null) return null;
  const s = signal.setup;
  const dir = s.direction === 'long' ? 'BUY' : 'SELL';
  const lines = [
    `${dir} ${s.coin} (${s.setupTimeframe}, ${signal.strategy.toUpperCase()})`,
    `Entry zone: ${s.entryZoneBottom} – ${s.entryZoneTop} (limit ${s.entry})`,
    `Stop: ${s.stopLoss}`,
    `TP1: ${s.takeProfit1}   TP2: ${s.takeProfit2}`,
    `RR: ${s.riskReward1.toFixed(2)} / ${s.riskReward2.toFixed(2)} (min ${s.riskReward1.toFixed(2)})`,
    `Signal: ${new Date(s.signalTime).toISOString()}`,
    `Checks: ${s.qualityPassed}/${s.qualityTotal} passed`,
    s.explanation,
  ];
  return lines.join('\n');
}

/**
 * Delivery gate. Returns false for NO_TRADE/diagnostic signals, stale data
 * (older than `maxAgeMs`), filtered-out strategies/markets/quality, and
 * already-sent ids.
 */
export function shouldSendAlert(
  signal: Signal,
  filter: AlertFilter,
  sentIds: Set<string>,
  now: number,
  maxAgeMs = 15 * 60_000,
): boolean {
  if (signal.setup == null) return false;
  if (signal.state !== 'WAITING_FOR_RETEST' && signal.state !== 'ACTIVE') return false;
  if (sentIds.has(signal.id)) return false;
  if (!filter.strategies.includes(signal.strategy)) return false;
  if (filter.coins.length > 0 && !filter.coins.includes(signal.coin)) return false;
  if (signal.setup.qualityPassed < filter.minQuality) return false;
  if (now - signal.setup.dataTime > maxAgeMs) return false;
  return true;
}
