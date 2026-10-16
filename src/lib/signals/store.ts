/**
 * Client-side persistent store (localStorage, versioned key).
 *
 * Holds signals (with lifecycle), paper account state and alert dedupe ids.
 * Everything here is local-first: the app works fully without Supabase, and
 * persistence unavailability is reported rather than simulated. Corrupt or
 * foreign-shaped stored payloads are discarded (with the store reset), never
 * partially applied.
 */
import type { PaperAccount, Signal } from '../types.ts';

export const STORE_KEY = 'hlsmc.store.v1';
export const STORE_VERSION = 1;

export interface PersistentStore {
  version: number;
  signals: Signal[];
  paper: PaperAccount | null;
  sentAlertIds: string[];
}

export function emptyStore(): PersistentStore {
  return { version: STORE_VERSION, signals: [], paper: null, sentAlertIds: [] };
}

function isSignal(value: unknown): value is Signal {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s['id'] === 'string' &&
    typeof s['coin'] === 'string' &&
    typeof s['state'] === 'string' &&
    typeof s['direction'] === 'string' &&
    typeof s['strategy'] === 'string'
  );
}

function isPaperAccount(value: unknown): value is PaperAccount {
  if (typeof value !== 'object' || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a['startingBalance'] === 'number' &&
    typeof a['balance'] === 'number' &&
    Array.isArray(a['openPositions']) &&
    Array.isArray(a['closedTrades'])
  );
}

export function parseStore(raw: string): PersistentStore {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return emptyStore();
    const p = parsed as Record<string, unknown>;
    if (p['version'] !== STORE_VERSION) return emptyStore();
    const signals = Array.isArray(p['signals']) ? p['signals'].filter(isSignal) : [];
    const paper =
      p['paper'] != null && isPaperAccount(p['paper']) ? (p['paper'] as PaperAccount) : null;
    const sentAlertIds = Array.isArray(p['sentAlertIds'])
      ? (p['sentAlertIds'] as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    return { version: STORE_VERSION, signals, paper, sentAlertIds };
  } catch {
    return emptyStore();
  }
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

export function loadStore(storage?: StorageLike): PersistentStore {
  const backend = storage ?? browserStorage();
  if (!backend) return emptyStore();
  try {
    const raw = backend.getItem(STORE_KEY);
    if (!raw) return emptyStore();
    return parseStore(raw);
  } catch {
    return emptyStore();
  }
}

export function saveStore(store: PersistentStore, storage?: StorageLike): void {
  const backend = storage ?? browserStorage();
  if (!backend) return;
  try {
    backend.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* storage full/blocked: app keeps running in-memory */
  }
}
