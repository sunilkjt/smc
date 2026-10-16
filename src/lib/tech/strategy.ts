/**
 * Technical Confluence — OPTIONAL, DISABLED-BY-DEFAULT comparison strategy.
 *
 * It exists so SMC can be compared honestly against a classical indicator
 * stack. Rules are deterministic and use closed candles only:
 * - LONG confluence (all mandatory): close > EMA50 > EMA200 (trend stack),
 *   50 ≤ RSI(14) ≤ 70 (momentum, not overbought), MACD hist > 0 (alignment),
 *   HTF close > HTF EMA50 (higher-timeframe agreement), relative volume ≥ 1
 *   (participation). SHORT mirrors.
 * - Risk is ATR-derived, NOT liquidity-derived (documented simplification):
 *   SL = 2×ATR against, TP1 = 2R, TP2 = 3R. Scores are never merged with SMC;
 *   tech signals carry strategy 'tech' with separate history and metrics.
 *
 * The engine gate (`enabled` flag, default false) lives in settings/UI —
 * this module only evaluates; it never enables itself.
 */
import type { Candle, FullCoinId, SignalDirection } from '../types.ts';
import { atrSeries, emaSeries, macdSeries, relativeVolume, rsiSeries } from './indicators.ts';

export interface TechEvaluation {
  direction: SignalDirection | 'none';
  reasons: string[];
  snapshot: {
    ema20: number | null;
    ema50: number | null;
    ema200: number | null;
    rsi14: number | null;
    macdHist: number | null;
    atr: number | null;
    relVol: number | null;
    htfTrendUp: boolean | null;
  };
  /** ATR-derived risk plan (present only when direction is set). */
  plan: { entry: number; stopLoss: number; takeProfit1: number; takeProfit2: number } | null;
}

export interface TechInputs {
  coin: FullCoinId;
  /** Closed setup-TF candles, ascending. */
  candles: Candle[];
  /** Closed HTF candles, ascending. */
  htf: Candle[];
}

function lastValid(series: number[]): number | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const v = series[i];
    if (v != null && !Number.isNaN(v)) return v;
  }
  return null;
}

export function evaluateTech(inputs: TechInputs): TechEvaluation {
  const { candles, htf } = inputs;
  const closes = candles.map((c) => c.close);
  const need = 210;
  if (candles.length < need || htf.length < 60) {
    return {
      direction: 'none',
      reasons: ['insufficient history (need 210 setup + 60 HTF bars)'],
      snapshot: {
        ema20: null, ema50: null, ema200: null, rsi14: null,
        macdHist: null, atr: null, relVol: null, htfTrendUp: null,
      },
      plan: null,
    };
  }

  const ema20 = lastValid(emaSeries(closes, 20));
  const ema50 = lastValid(emaSeries(closes, 50));
  const ema200 = lastValid(emaSeries(closes, 200));
  const rsi14 = lastValid(rsiSeries(closes, 14));
  const macdHist = lastValid(macdSeries(closes).hist);
  const atr = lastValid(atrSeries(candles, 14));
  const relVol = relativeVolume(candles.map((c) => c.volume));
  const htfCloses = htf.map((c) => c.close);
  const htfEma50 = lastValid(emaSeries(htfCloses, 50));
  const htfClose = htfCloses[htfCloses.length - 1] ?? null;
  const htfTrendUp = htfClose != null && htfEma50 != null ? htfClose > htfEma50 : null;
  const close = closes[closes.length - 1] ?? Number.NaN;

  const snapshot = { ema20, ema50, ema200, rsi14, macdHist, atr, relVol, htfTrendUp };
  const complete =
    ema20 != null && ema50 != null && ema200 != null && rsi14 != null &&
    macdHist != null && atr != null && atr > 0 && relVol != null && htfTrendUp != null;
  if (!complete) {
    return { direction: 'none', reasons: ['indicators not yet valid'], snapshot, plan: null };
  }

  const longVotes = [
    close > (ema50 as number),
    (ema50 as number) > (ema200 as number),
    (rsi14 as number) >= 50 && (rsi14 as number) <= 70,
    (macdHist as number) > 0,
    htfTrendUp === true,
    (relVol as number) >= 1,
  ];
  const shortVotes = [
    close < (ema50 as number),
    (ema50 as number) < (ema200 as number),
    (rsi14 as number) >= 30 && (rsi14 as number) <= 50,
    (macdHist as number) < 0,
    htfTrendUp === false,
    (relVol as number) >= 1,
  ];
  const labels = ['price-vs-ema50', 'trend-stack', 'rsi-band', 'macd-align', 'htf-agree', 'volume'];

  if (longVotes.every(Boolean)) {
    return {
      direction: 'long',
      reasons: ['6/6 long confluence'],
      snapshot,
      plan: {
        entry: close,
        stopLoss: close - 2 * (atr as number),
        takeProfit1: close + 4 * (atr as number),
        takeProfit2: close + 6 * (atr as number),
      },
    };
  }
  if (shortVotes.every(Boolean)) {
    return {
      direction: 'short',
      reasons: ['6/6 short confluence'],
      snapshot,
      plan: {
        entry: close,
        stopLoss: close + 2 * (atr as number),
        takeProfit1: close - 4 * (atr as number),
        takeProfit2: close - 6 * (atr as number),
      },
    };
  }
  const longMissed = labels.filter((_, i) => !longVotes[i]);
  const shortMissed = labels.filter((_, i) => !shortVotes[i]);
  return {
    direction: 'none',
    reasons: [
      `long missing: ${longMissed.join(', ') || '—'}`,
      `short missing: ${shortMissed.join(', ') || '—'}`,
    ],
    snapshot,
    plan: null,
  };
}
