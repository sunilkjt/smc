/**
 * Signal generation: run the deterministic SMC setup for both directions and
 * wrap results in lifecycle-tracked signals with stable ids.
 *
 * - A valid setup becomes WAITING_FOR_RETEST (entry defined, fill pending).
 * - A failed evaluation becomes a NO_TRADE diagnostic signal (same stable id
 *   space, so dashboards can show per-market long/short diagnostics without
 *   ever mistaking them for tradable signals).
 * - `ingestScan` merges new signals into existing ones by id: identical ids
 *   never duplicate; stored lifecycle progress (ACTIVE/RESOLVED/...) is never
 *   overwritten by a fresh scan.
 */
import { generateSetup } from '../smc/setup.ts';
import type {
  Candle,
  EngineConfig,
  FullCoinId,
  Signal,
  SignalDirection,
} from '../types.ts';
import { stableSignalId } from './ids.ts';

export interface ScanInputs {
  coin: FullCoinId;
  context: Candle[];
  setup: Candle[];
  config: EngineConfig;
  dataNow: number;
  scannedAt: number;
}

/** Evaluate long + short; always returns exactly two signals ( tradable or diagnostic). */
export function scanDirections(inputs: ScanInputs): Signal[] {
  const out: Signal[] = [];
  for (const direction of ['long', 'short'] as SignalDirection[]) {
    const result = generateSetup(
      {
        coin: inputs.coin,
        context: inputs.context,
        setup: inputs.setup,
        config: inputs.config,
        dataNow: inputs.dataNow,
      },
      direction,
    );
    if (result.kind === 'setup') {
      const id = stableSignalId('smc', result.setup);
      out.push({
        id,
        strategy: 'smc',
        coin: inputs.coin,
        setupTimeframe: result.setup.setupTimeframe,
        direction,
        state: 'WAITING_FOR_RETEST',
        setup: result.setup,
        noTradeReason: null,
        note: null,
        createdAt: inputs.scannedAt,
        updatedAt: inputs.scannedAt,
        entryFilledAt: null,
        resolvedAt: null,
        resolution: null,
      });
    } else {
      out.push({
        id: `smc:${inputs.coin}:${inputs.config.setupTimeframe}:${direction}:no-trade:${result.reason}`,
        strategy: 'smc',
        coin: inputs.coin,
        setupTimeframe: inputs.config.setupTimeframe,
        direction,
        state: 'NO_TRADE',
        setup: null,
        noTradeReason: result.reason,
        note: result.detail,
        createdAt: inputs.scannedAt,
        updatedAt: inputs.scannedAt,
        entryFilledAt: null,
        resolvedAt: null,
        resolution: null,
      });
    }
  }
  return out;
}

/**
 * Merge fresh scan results into the stored list. Stored non-diagnostic
 * signals win on id collision (lifecycle progress is preserved); NO_TRADE
 * diagnostics are replaced by the latest scan.
 */
export function ingestScan(existing: Signal[], fresh: Signal[]): Signal[] {
  const byId = new Map<string, Signal>();
  for (const s of existing) byId.set(s.id, s);
  for (const s of fresh) {
    const kept = byId.get(s.id);
    if (!kept) {
      byId.set(s.id, s);
    } else if (kept.state === 'NO_TRADE' && s.state === 'NO_TRADE') {
      byId.set(s.id, s); // refresh diagnostics
    }
    // Otherwise the stored signal (with lifecycle progress) stands.
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}
