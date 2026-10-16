/**
 * Telegram command parsing and reply formatting (pure, tested).
 * Delivery and polling live in scripts/telegram-commands.ts. Only the owner
 * chat id may issue commands — everything else is ignored, never answered
 * (no oracle for strangers).
 */
import type { PaperPosition, Signal } from '../types.ts';

export type BotCommand = 'scan' | 'status' | 'positions' | 'signals' | 'help';

export interface ParsedCommand {
  command: BotCommand;
  args: string[];
}

/** Parse "/cmd args..." — strips an optional @bot suffix. Null when not a command. */
export function parseCommand(text: unknown): ParsedCommand | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) {
    // Bare "help"/"start" (no slash) still gets an answer — everything else
    // stays silent so group chatter never triggers replies.
    const word = trimmed.toLowerCase();
    if (word === 'help' || word === 'start') return { command: 'help', args: [] };
    return null;
  }
  const [head, ...args] = trimmed.slice(1).split(/\s+/);
  const name = (head ?? '').split('@')[0]?.toLowerCase() ?? '';
  if (name !== 'scan' && name !== 'status' && name !== 'positions' && name !== 'signals' && name !== 'help') {
    return { command: 'help', args: [] }; // unknown slash input → help, never silence
  }
  return { command: name, args };
}

export function isOwner(chatId: unknown, ownerId: string): boolean {
  return String(chatId ?? '') === ownerId;
}

export const HELP_TEXT = [
  'SMC Stocks commands:',
  '/scan [N] — run a fresh scan now (N markets, 3-10) and reply with setups',
  '/status — last scheduled scan summary',
  '/positions — open paper positions',
  '/signals — latest actionable signals',
  '/help — this message',
].join('\n');

export function formatStatus(
  latest: { ranAt: string; verifiedStocks: number; signalsNew: number; error: string | null } | null,
  openCount: number,
): string {
  if (!latest) return 'No scheduled scan has been recorded yet.';
  const when = new Date(latest.ranAt).toISOString().replace('T', ' ').slice(0, 16);
  const err = latest.error ? `\nLast error: ${latest.error.slice(0, 200)}` : '';
  return `Last scan: ${when} UTC\nVerified stocks: ${latest.verifiedStocks}\nNew signals: ${latest.signalsNew}\nOpen paper positions: ${openCount}${err}`;
}

export function formatPositions(open: PaperPosition[]): string {
  if (open.length === 0) return 'No open paper positions.';
  return open
    .slice(0, 10)
    .map(
      (p) =>
        `${p.direction === 'long' ? 'LONG' : 'SHORT'} ${p.coin} ${p.size.toFixed(4)} @ ${p.entry} ` +
        `(SL ${p.stopLoss}, TP ${p.takeProfit1}/${p.takeProfit2}, risk $${p.riskAmount.toFixed(0)}${p.tp1Taken ? ', TP1 taken' : ''})`,
    )
    .join('\n');
}

export function formatSignals(signals: Signal[]): string {
  const tradable = signals.filter((s) => s.setup != null);
  if (tradable.length === 0) return 'No actionable signals right now. Quality over quantity — NO_TRADE is the default.';
  return tradable
    .slice(0, 8)
    .map((s) => {
      const setup = s.setup;
      if (!setup) return '';
      const dir = setup.direction === 'long' ? 'BUY' : 'SELL';
      return `${dir} ${setup.coin} (${setup.setupTimeframe}) entry ${setup.entry}, SL ${setup.stopLoss}, TP ${setup.takeProfit1}/${setup.takeProfit2}, RR ${setup.riskReward1.toFixed(2)} [${s.state}]`;
    })
    .filter(Boolean)
    .join('\n');
}

/** Split long replies at Telegram's 4096-char limit (backward, no mid-line cuts). */
export function splitReply(text: string, limit = 4000): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  const lines = text.split('\n');
  let current = '';
  for (const line of lines) {
    if ((current + '\n' + line).length > limit && current) {
      parts.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) parts.push(current);
  return parts;
}
