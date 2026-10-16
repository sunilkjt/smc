/**
 * Telegram command poller: makes the alert bot two-way.
 * Runs on a schedule (GitHub Actions, every ~5 min) or on demand. Each pass:
 * getUpdates since the stored offset → handle owner-only commands → reply →
 * persist the new offset. Strangers are ignored silently (no oracle).
 *
 * Commands: /scan [N] (fresh scan, 3-10 markets), /status, /positions,
 * /signals, /help. /scan shares the headless scan core, so results persist
 * to Supabase with full lifecycle + paper continuity.
 *
 * Required env (server-side only): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (or
 * OWNER_CHAT_ID), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Optional: TOP_N (default scan depth 5), MIN_RR (default 2).
 *
 * Usage: npm run telegram
 */
import { formatSignalAlert, shouldSendAlert } from '../src/lib/alerts/format.ts';
import { runHeadlessScan } from '../src/lib/headless-scan.ts';
import {
  HELP_TEXT,
  formatPositions,
  formatSignals,
  formatStatus,
  isOwner,
  parseCommand,
  splitReply,
} from '../src/lib/telegram/commands.ts';
import {
  getMeta,
  latestScan,
  loadAlertCandidates,
  loadSignals,
  loadTrades,
  markAlerted,
  setMeta,
  validateSbConfig,
  type SbConfig,
} from '../src/lib/supabase-sync.ts';

const OFFSET_KEY = 'tg_offset';

async function tg(token: string, method: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Telegram ${method} failed: HTTP ${res.status}`);
  const payload = (await res.json()) as { ok?: boolean; result?: unknown; description?: string };
  if (!payload.ok) throw new Error(`Telegram ${method} refused: ${payload.description ?? 'unknown'}`);
  return payload.result;
}

async function reply(token: string, chatId: string, text: string): Promise<void> {
  for (const part of splitReply(text)) {
    await tg(token, 'sendMessage', { chat_id: chatId, text: part, disable_web_page_preview: true });
  }
}

function clampN(raw: string | undefined, fallback: number): number {
  const n = Number(raw ?? '');
  if (!Number.isInteger(n)) return fallback;
  return Math.min(10, Math.max(3, n));
}

async function main(): Promise<void> {
  const token = process.env['TELEGRAM_BOT_TOKEN'];
  const owner = process.env['TELEGRAM_CHAT_ID'] ?? process.env['OWNER_CHAT_ID'];
  const sbUrl = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL'];
  const sbKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!token || !owner || !sbUrl || !sbKey) {
    console.log('Telegram commands not configured (need TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). Skipping.');
    return;
  }
  const sb: SbConfig = { url: sbUrl, key: sbKey };
  validateSbConfig(sb);

  const offsetRaw = await getMeta(sb, OFFSET_KEY);
  const offset = offsetRaw != null && /^\d+$/.test(offsetRaw) ? Number(offsetRaw) : 0;
  const updates = (await tg(token, 'getUpdates', { offset, timeout: 0 })) as Array<{
    update_id?: number;
    message?: { chat?: { id?: number | string }; text?: string; from?: { is_bot?: boolean } };
  }>;
  if (!Array.isArray(updates) || updates.length === 0) {
    console.log('No new Telegram updates.');
    return;
  }

  let maxId = offset;
  for (const update of updates) {
    const id = typeof update.update_id === 'number' ? update.update_id : 0;
    maxId = Math.max(maxId, id);
    try {
      const msg = update.message;
      const chatId = msg?.chat?.id;
      if (!isOwner(chatId, owner)) continue; // strangers: silent ignore
      if (msg?.from?.is_bot === true) continue;
      const parsed = parseCommand(msg?.text);
      if (!parsed) continue; // not a command: no reply (alerts stay one-way signal)
      const chat = String(chatId);
      if (parsed.command === 'help') {
        await reply(token, chat, HELP_TEXT);
      } else if (parsed.command === 'status') {
        const latest = await latestScan(sb);
        const trades = await loadTrades(sb);
        await reply(token, chat, formatStatus(latest, trades.open.length));
      } else if (parsed.command === 'positions') {
        const trades = await loadTrades(sb);
        await reply(token, chat, formatPositions(trades.open));
      } else if (parsed.command === 'signals') {
        const { signals } = await loadSignals(sb);
        const actionable = signals.filter((s) => s.setup != null && (s.state === 'WAITING_FOR_RETEST' || s.state === 'ACTIVE'));
        await reply(token, chat, formatSignals(actionable));
      } else if (parsed.command === 'scan') {
        const n = clampN(parsed.args[0], Number(process.env['TOP_N'] ?? 5));
        await reply(token, chat, `Scanning top ${n} verified stocks — results in ~1-2 min…`);
        const result = await runHeadlessScan({
          topN: n,
          techEnabled: false,
          minRR: Number(process.env['MIN_RR'] ?? 2),
          sb,
          paperStart: 10_000,
          paperRisk: 1,
          onLog: (message) => console.log(`[scan] ${message}`),
        });
        const tradable = result.results.flatMap((r) => r.scan.signals).filter((s) => s.setup != null && s.state !== 'NO_TRADE');
        if (tradable.length === 0) {
          await reply(token, chat, `Scan done: ${result.discovery.markets.length} stocks checked, NO_TRADE everywhere. Quality over quantity.`);
        } else {
          await reply(token, chat, `Scan done: ${tradable.length} setup(s).\n` + formatSignals(tradable));
          // Deliver full alert cards for the fresh setups (DB dedupe applies).
          const sent = new Set<string>();
          for (const s of tradable) {
            if (!shouldSendAlert(s, { strategies: ['smc', 'tech'], coins: [], minQuality: 6 }, sent, Date.now())) continue;
            const text = formatSignalAlert(s);
            if (!text) continue;
            await reply(token, chat, text);
            await markAlerted(sb, [s.id]);
            sent.add(s.id);
          }
        }
      }
    } catch (err) {
      console.log(`update ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await setMeta(sb, OFFSET_KEY, String(maxId + 1));
  console.log(`Processed ${updates.length} update(s).`);
}

main().catch((err: unknown) => {
  console.error(`TELEGRAM POLL FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
