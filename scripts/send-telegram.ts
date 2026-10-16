/**
 * Optional Telegram dispatch for headless scan results.
 * Server-side only: reads TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID from the
 * environment (GitHub Actions secrets). The browser never holds the token.
 *
 * Two dedupe modes:
 * - Supabase mode (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set): loads
 *   fresh unalerted signals from the DB, sends, and marks alerted_at — so
 *   dedupe survives across ephemeral scheduled runs.
 * - File mode (fallback): reads scan-results.json, dedupes via sent-ids.json.
 * Failures exit non-zero but never touch signals.
 *
 * Usage: npm run alert -- (after npm run scan)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { formatSignalAlert, shouldSendAlert } from '../src/lib/alerts/format.ts';
import {
  loadAlertCandidates,
  markAlerted,
  type SbConfig,
} from '../src/lib/supabase-sync.ts';
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
  const sbUrl = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL'];
  const sbKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const sb: SbConfig | null = sbUrl && sbKey ? { url: sbUrl, key: sbKey } : null;

  const now = Date.now();
  let delivered = 0;
  if (sb) {
    // DB mode: cross-run dedupe via alerted_at.
    const candidates = await loadAlertCandidates(sb);
    for (const s of candidates) {
      if (!shouldSendAlert(s, { strategies: ['smc', 'tech'], coins: [], minQuality: 6 }, new Set(), now)) {
        continue;
      }
      const text = formatSignalAlert(s);
      if (!text) continue;
      await sendMessage(token, chatId, text);
      await markAlerted(sb, [s.id]);
      delivered += 1;
      console.log(`sent ${s.id}`);
    }
    console.log(`Delivered ${delivered} alert(s) (supabase dedupe).`);
    return;
  }

  const raw: unknown = JSON.parse(readFileSync(resultsPath, 'utf8'));
  const signals = (raw as { signals?: unknown }).signals;
  if (!Array.isArray(signals)) throw new Error(`${resultsPath} has no signals array`);
  const sent: string[] = existsSync(idsPath)
    ? (JSON.parse(readFileSync(idsPath, 'utf8')) as unknown as string[]).filter((x) => typeof x === 'string')
    : [];
  const sentIds = new Set(sent);
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
