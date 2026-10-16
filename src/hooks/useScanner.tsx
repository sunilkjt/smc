import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useDiscovery } from './useDiscovery.tsx';
import {
  applyScan,
  evaluateMarket,
  fetchMarketCandles,
  type MarketScan,
  type ScanMarketPlan,
} from '../lib/scan.ts';
import { loadStore, saveStore, type PersistentStore } from '../lib/signals/store.ts';
import { createAccount } from '../lib/paper/engine.ts';
import { DEFAULT_ENGINE_CONFIG, type EngineConfig, type PaperAccount, type Signal } from '../lib/types.ts';
import type { TechEvaluation } from '../lib/tech/strategy.ts';

export interface ScannerSettings {
  topN: number;
  minRiskReward: number;
  riskPct: number;
  startingBalance: number;
  techEnabled: boolean;
}

const SETTINGS_KEY = 'hlsmc.settings.v1';

const DEFAULT_SETTINGS: ScannerSettings = {
  topN: 8,
  minRiskReward: 2,
  riskPct: 1,
  startingBalance: 10_000,
  techEnabled: false,
};

function loadSettings(): ScannerSettings {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ScannerSettings>;
    return {
      topN: clampInt(parsed.topN, 3, 15, DEFAULT_SETTINGS.topN),
      minRiskReward: clampNum(parsed.minRiskReward, 0.5, 10, DEFAULT_SETTINGS.minRiskReward),
      riskPct: clampNum(parsed.riskPct, 0.1, 100, DEFAULT_SETTINGS.riskPct),
      startingBalance: clampNum(parsed.startingBalance, 100, 10_000_000, DEFAULT_SETTINGS.startingBalance),
      techEnabled: parsed.techEnabled === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function clampInt(v: unknown, lo: number, hi: number, fb: number): number {
  return typeof v === 'number' && Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : fb;
}

function clampNum(v: unknown, lo: number, hi: number, fb: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb;
}

export interface ScanProgress {
  running: boolean;
  done: number;
  total: number;
  current: string | null;
  error: string | null;
  lastScanAt: number | null;
  marketErrors: Array<{ coin: string; error: string }>;
}

export interface ScannerState {
  signals: Signal[];
  paper: PaperAccount;
  techByCoin: Map<string, TechEvaluation>;
  settings: ScannerSettings;
  engineConfig: EngineConfig;
  progress: ScanProgress;
  runScan: () => void;
  resetPaper: () => void;
  clearSignals: () => void;
  updateSettings: (patch: Partial<ScannerSettings>) => void;
}

const ScannerContext = createContext<ScannerState | null>(null);

export function ScannerProvider({ children }: { children: ReactNode }) {
  const discovery = useDiscovery();
  const [persisted, setPersisted] = useState<PersistentStore>(() => loadStore());
  const [settings, setSettings] = useState<ScannerSettings>(loadSettings);
  const [techByCoin, setTechByCoin] = useState<Map<string, TechEvaluation>>(new Map());
  const [progress, setProgress] = useState<ScanProgress>({
    running: false,
    done: 0,
    total: 0,
    current: null,
    error: null,
    lastScanAt: null,
    marketErrors: [],
  });

  const stateRef = useRef({ signals: persisted.signals, paper: persisted.paper });
  stateRef.current = { signals: persisted.signals, paper: persisted.paper };
  const runningRef = useRef(false);

  const engineConfig: EngineConfig = useMemo(
    () => ({ ...DEFAULT_ENGINE_CONFIG, minRiskReward: settings.minRiskReward }),
    [settings.minRiskReward],
  );

  const paper: PaperAccount = useMemo(
    () =>
      persisted.paper ??
      createAccount({ startingBalance: settings.startingBalance, riskPct: settings.riskPct }),
    [persisted.paper, settings.startingBalance, settings.riskPct],
  );

  const persist = useCallback((store: PersistentStore) => {
    setPersisted(store);
    saveStore(store);
  }, []);

  const runScan = useCallback(() => {
    if (runningRef.current) return;
    const markets = discovery.result?.markets ?? [];
    if (markets.length === 0) {
      setProgress((p) => ({ ...p, error: 'No verified markets — run discovery first.' }));
      return;
    }
    runningRef.current = true;
    const targets = markets.slice(0, settings.topN);
    const techEnabled = settings.techEnabled;
    const engine = { ...DEFAULT_ENGINE_CONFIG, minRiskReward: settings.minRiskReward };
    setProgress({
      running: true,
      done: 0,
      total: targets.length,
      current: null,
      error: null,
      lastScanAt: null,
      marketErrors: [],
    });

    void (async () => {
      const plans: ScanMarketPlan[] = [];
      const scans: MarketScan[] = [];
      const tech = new Map<string, TechEvaluation>();
      const marketErrors: Array<{ coin: string; error: string }> = [];
      const scannedAt = Date.now();
      for (const market of targets) {
        setProgress((p) => ({ ...p, current: market.id }));
        try {
          const { context, setup } = await fetchMarketCandles(market.id, engine);
          plans.push({ market, context, setup, contextTf: engine.contextTimeframe, setupTf: engine.setupTimeframe });
          const scan = evaluateMarket(market.id, context, setup, { topN: targets.length, engine, techEnabled }, scannedAt);
          if (scan.tech) tech.set(market.id, scan.tech);
          if (scan.error) marketErrors.push({ coin: market.id, error: scan.error });
          scans.push(scan);
        } catch (err) {
          // A market fetch failure is recorded, never converted to signals.
          marketErrors.push({
            coin: market.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
      const base = stateRef.current;
      const applied = applyScan(
        base.signals,
        base.paper,
        plans,
        scans,
        { topN: targets.length, engine, techEnabled },
        scannedAt,
      );
      persist({ version: 1, signals: applied.signals, paper: applied.paper, sentAlertIds: baseSentIds() });
      setTechByCoin(tech);
      runningRef.current = false;
      setProgress((p) => ({
        ...p,
        running: false,
        current: null,
        lastScanAt: scannedAt,
        marketErrors,
        error: plans.length === 0 ? 'All market fetches failed — no signals evaluated.' : null,
      }));
    })();
  }, [discovery.result, settings, persist]);

  const baseSentIds = (): string[] => {
    try {
      return loadStore().sentAlertIds;
    } catch {
      return [];
    }
  };

  const resetPaper = useCallback(() => {
    const base = stateRef.current;
    const fresh = createAccount({
      startingBalance: settings.startingBalance,
      riskPct: settings.riskPct,
    });
    persist({ version: 1, signals: base.signals, paper: fresh, sentAlertIds: baseSentIds() });
  }, [persist, settings.startingBalance, settings.riskPct]);

  const clearSignals = useCallback(() => {
    const base = stateRef.current;
    persist({ version: 1, signals: [], paper: base.paper, sentAlertIds: baseSentIds() });
  }, [persist]);

  const updateSettings = useCallback((patch: Partial<ScannerSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = useMemo<ScannerState>(
    () => ({
      signals: persisted.signals,
      paper,
      techByCoin,
      settings,
      engineConfig,
      progress,
      runScan,
      resetPaper,
      clearSignals,
      updateSettings,
    }),
    [persisted.signals, paper, techByCoin, settings, engineConfig, progress, runScan, resetPaper, clearSignals, updateSettings],
  );
  return <ScannerContext.Provider value={value}>{children}</ScannerContext.Provider>;
}

export function useScanner(): ScannerState {
  const ctx = useContext(ScannerContext);
  if (!ctx) throw new Error('useScanner must be used inside <ScannerProvider>');
  return ctx;
}
