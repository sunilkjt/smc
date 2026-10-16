/**
 * Market discovery: enumerate every perp asset on every DEX, join builder
 * category metadata, and keep only verified stock/equity-linked markets.
 *
 * Data flow (sequential `/info` calls, each validated before use):
 *   1. `perpDexs` — DEX names + display names (drives the per-DEX loop).
 *   2. `metaAndAssetCtxs` per DEX — `[meta, assetCtxs]` tuple with universe,
 *      mark prices and volumes. NOTE: the documented `allPerpMetas` endpoint
 *      was probed live and returns bare meta objects WITHOUT asset contexts
 *      (docs show tuples, reality differs), so per-DEX `metaAndAssetCtxs`
 *      calls are required for prices/volumes.
 *   3. `perpCategories` — builder-declared `[fullCoinId, category]` pairs.
 *
 * The DEX of each asset is derived from its own `dex:COIN` name prefix and
 * cross-checked against the DEX being queried — never from array position —
 * so reordering or misattribution fails loudly instead of corrupting data.
 *
 * Verification rules:
 * - Delisted assets (`isDelisted`) are skipped.
 * - `STOCK` requires a `stocks`/`stock` builder category (see
 *   classification.ts). Anything else is counted in `excludedCount` with a
 *   short reason sample — never silently ignored, never signalled.
 * - The pure `assembleDiscovery()` step is exported for unit tests so the
 *   join/classify/sort logic is tested without network access.
 */

import { isRecord, postInfo, type PostInfoOptions } from './client.ts';
import { classifyMarket, splitCoinId } from './classification.ts';
import type { DiscoveryResult, Market } from '../types.ts';

export interface RawUniverseEntry {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
  isDelisted?: boolean;
}

export interface RawAssetCtx {
  markPx?: string | null;
  midPx?: string | null;
  oraclePx?: string | null;
  prevDayPx?: string | null;
  dayNtlVlm?: string | null;
  openInterest?: string | null;
}

/** One DEX's validated metadata: universe plus aligned asset contexts. */
export interface DexMetaSnapshot {
  /** DEX name (`""` for the main perp DEX). */
  dex: string;
  dexDisplayName?: string;
  universe: unknown[];
  ctxs: unknown[];
}

function isUniverseEntry(value: unknown): value is RawUniverseEntry {
  return (
    isRecord(value) &&
    typeof value['name'] === 'string' &&
    typeof value['szDecimals'] === 'number' &&
    typeof value['maxLeverage'] === 'number'
  );
}

function isMetaAndCtxsTuple(value: unknown): value is [{ universe: unknown[] }, unknown[]] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isRecord(value[0]) &&
    Array.isArray((value[0] as Record<string, unknown>)['universe']) &&
    Array.isArray(value[1])
  );
}

function isCategories(value: unknown): value is Array<[string, string]> {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'string',
    )
  );
}

function isPerpDexs(value: unknown): value is Array<null | { name?: unknown; fullName?: unknown }> {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry === null ||
        (isRecord(entry) &&
          (entry['name'] == null || typeof entry['name'] === 'string') &&
          (entry['fullName'] == null || typeof entry['fullName'] === 'string')),
    )
  );
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export interface AssembleInputs {
  dexMetas: DexMetaSnapshot[];
  categories: Array<[string, string]>;
  fetchedAt: number;
}

/**
 * Pure join/classify/sort step. Throws on malformed universe entries or on a
 * DEX-prefix mismatch (an asset whose `dex:COIN` prefix disagrees with the
 * DEX snapshot it came from) — markets with corrupt metadata fail loudly and
 * are never skipped silently. Assets whose *category* is missing simply
 * classify as UNKNOWN.
 */
export function assembleDiscovery(inputs: AssembleInputs): DiscoveryResult {
  const categoryByCoin = new Map<string, string>();
  for (const [coin, category] of inputs.categories) categoryByCoin.set(coin, category);

  const markets: Market[] = [];
  const excludedSample: Array<{ id: string; reason: string }> = [];
  let excludedCount = 0;
  let totalAssets = 0;

  const pushExcluded = (id: string, reason: string): void => {
    excludedCount += 1;
    if (excludedSample.length < 10) excludedSample.push({ id, reason });
  };

  for (const snapshot of inputs.dexMetas) {
    for (let i = 0; i < snapshot.universe.length; i += 1) {
      const entry = snapshot.universe[i];
      if (!isUniverseEntry(entry)) {
        throw new Error(
          `Universe entry failed shape validation on dex "${snapshot.dex}": ${JSON.stringify(entry)?.slice(0, 200)}`,
        );
      }
      totalAssets += 1;
      const id = entry.name;
      if (entry.isDelisted === true) {
        pushExcluded(id, 'delisted');
        continue;
      }
      const { dex, coin } = splitCoinId(id);
      if (dex !== snapshot.dex) {
        throw new Error(
          `DEX prefix mismatch: asset "${id}" listed under dex "${snapshot.dex}"`,
        );
      }
      const rawCategory = categoryByCoin.get(id);
      if (classifyMarket(rawCategory) !== 'STOCK') {
        pushExcluded(
          id,
          rawCategory == null ? 'UNKNOWN (no builder category)' : `non-equity (${rawCategory})`,
        );
        continue;
      }
      const ctx = (snapshot.ctxs[i] ?? {}) as RawAssetCtx;
      markets.push({
        id,
        dex,
        coin,
        dexFullName: snapshot.dexDisplayName,
        szDecimals: entry.szDecimals,
        maxLeverage: entry.maxLeverage,
        onlyIsolated: entry.onlyIsolated,
        builderCategory: rawCategory,
        classification: 'STOCK',
        markPx: toNumberOrUndefined(ctx.markPx),
        midPx: toNumberOrUndefined(ctx.midPx),
        oraclePx: toNumberOrUndefined(ctx.oraclePx),
        prevDayPx: toNumberOrUndefined(ctx.prevDayPx),
        dayNtlVlm: toNumberOrUndefined(ctx.dayNtlVlm),
        openInterest: toNumberOrUndefined(ctx.openInterest),
      });
    }
  }

  markets.sort((a, b) => (b.dayNtlVlm ?? 0) - (a.dayNtlVlm ?? 0));
  return {
    markets,
    excludedCount,
    excludedSample,
    dexCount: inputs.dexMetas.length,
    totalAssets,
    fetchedAt: inputs.fetchedAt,
  };
}

/**
 * Run live market discovery against the Hyperliquid public API.
 * Throws `HyperliquidError` on network/shape failure — never resolves with
 * an empty result caused by a failed call.
 */
export async function discoverStockMarkets(opts?: PostInfoOptions): Promise<DiscoveryResult> {
  // Sequential on purpose: keeps IP weight low and ordering deterministic.
  const dexs = await postInfo({ type: 'perpDexs' }, isPerpDexs, opts);
  const dexNames: string[] = [''];
  const displayNames = new Map<string, string>([['', 'Hyperliquid (main)']]);
  for (const entry of dexs) {
    if (entry !== null && typeof entry.name === 'string' && !dexNames.includes(entry.name)) {
      dexNames.push(entry.name);
      displayNames.set(entry.name, typeof entry.fullName === 'string' ? entry.fullName : entry.name);
    }
  }

  const dexMetas: DexMetaSnapshot[] = [];
  for (const dex of dexNames) {
    const body = dex === '' ? { type: 'metaAndAssetCtxs' } : { type: 'metaAndAssetCtxs', dex };
    const [meta, ctxs] = await postInfo(body, isMetaAndCtxsTuple, opts);
    dexMetas.push({
      dex,
      dexDisplayName: displayNames.get(dex),
      universe: meta.universe,
      ctxs,
    });
  }

  const categories = await postInfo({ type: 'perpCategories' }, isCategories, opts);
  return assembleDiscovery({ dexMetas, categories, fetchedAt: Date.now() });
}
