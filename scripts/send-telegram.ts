/**
 * Optional Telegram dispatch for headless scan results.
 * Server-side only: reads TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID from the
 * environment (GitHub Actions secrets). Reads scan-results.json, formats
 * fresh WAITING_FOR_RETEST signals, sends, and records sent ids in
 * sent-ids.json for dedupe. Failures exit non-zero but never touch signals.
 *
 * Usage: npm run alert -- (after npm run scan)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { formatSignalAlert, shouldSendAlert } from '../src/lib/alerts/format.ts';
import type { Signal } from '../src/lib/types.ts';

async function sendMessage(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function main(): Promise<void> {
  const token = process.env['TELEGRAM_BOT_TOKEN'];
  const chatId = process.env['TELEGRAM_CHAT_ID'];
  if (!token || !chatId) {
    console.log('Telegram not configured (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID missing). Skipping.');
    return;
  }
  const resultsPath = process.env['IN'] ?? 'scan-results.json';
  const idsPath = process.env['IDS'] ?? 'sent-ids.json';
  const raw: unknown = JSON.parse(readFileSync(resultsPath, 'utf8'));
  const signals = (raw as { signals?: unknown }).signals;
  if (!Array.isArray(signals)) throw new Error(`${resultsPath} has no signals array`);
  const sent: string[] = existsSync(idsPath)
    ? (JSON.parse(readFileSync(idsPath, 'utf8')) as unknown as string[]).filter((x) => typeof x === 'string')
    : [];
  const sentIds = new Set(sent);
  const now = Date.now();
  let delivered = 0;
  for (const maybe of signals) {
    const s = maybe as Signal;
    if (s?.setup == null || typeof s.id !== 'string') continue;
    if (!shouldSendAlert(s, { strategies: ['smc', 'tech'], coins: [], minQuality: 6 }, sentIds, now)) {
      continue;
    }
    const text = formatSignalAlert(s);
    if (!text) continue;
    await sendMessage(token, chatId, text);
    sentIds.add(s.id);
    delivered += 1;
    console.log(`sent ${s.id}`);
  }
  writeFileSync(idsPath, JSON.stringify([...sentIds], null, 2));
  console.log(`Delivered ${delivered} alert(s).`);
}

main().catch((err: unknown) => {
  console.error(`ALERT FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
