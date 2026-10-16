import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { discoverStockMarkets } from '../lib/hyperliquid/index.ts';
import type { DiscoveryResult } from '../lib/types.ts';

export type DiscoveryStatus = 'idle' | 'loading' | 'live' | 'error';

export interface DiscoveryState {
  status: DiscoveryStatus;
  result: DiscoveryResult | null;
  error: string | null;
  /** Timestamp of the last successful scan (`null` until the first one). */
  lastSuccessAt: number | null;
  refresh: () => void;
}

/** Module-level cache: navigating between pages must not refetch. */
let cachedResult: DiscoveryResult | null = null;
let cachedAt: number | null = null;
let inflight: Promise<DiscoveryResult> | null = null;

const DiscoveryContext = createContext<DiscoveryState | null>(null);

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function DiscoveryProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<DiscoveryStatus>(cachedResult ? 'live' : 'idle');
  const [result, setResult] = useState<DiscoveryResult | null>(cachedResult);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(cachedAt);

  const refresh = useCallback(() => {
    if (inflight) return;
    setStatus(cachedResult ? 'live' : 'loading');
    const job = discoverStockMarkets()
      .then((r) => {
        cachedResult = r;
        cachedAt = r.fetchedAt;
        setResult(r);
        setLastSuccessAt(r.fetchedAt);
        setError(null);
        setStatus('live');
        return r;
      })
      .catch((err: unknown) => {
        // A failed scan is surfaced as an error state — never as an empty
        // market list. Previously cached data (if any) stays visible.
        setError(describeError(err));
        setStatus(cachedResult ? 'live' : 'error');
        throw err;
      })
      .finally(() => {
        if (inflight === job) inflight = null;
      });
    inflight = job;
    void job.catch(() => {
      /* handled via state above */
    });
  }, []);

  useEffect(() => {
    if (!cachedResult) refresh();
  }, [refresh]);

  const value = useMemo<DiscoveryState>(
    () => ({ status, result, error, lastSuccessAt, refresh }),
    [status, result, error, lastSuccessAt, refresh],
  );
  return <DiscoveryContext.Provider value={value}>{children}</DiscoveryContext.Provider>;
}

export function useDiscovery(): DiscoveryState {
  const ctx = useContext(DiscoveryContext);
  if (!ctx) throw new Error('useDiscovery must be used inside <DiscoveryProvider>');
  return ctx;
}
