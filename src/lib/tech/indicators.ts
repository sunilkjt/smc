/**
 * Deterministic technical indicators on CLOSED candles. Pure functions,
 * no look-ahead (each output at index i uses inputs ≤ i).
 */
import { trueRange } from '../smc/atr.ts';
import type { Candle } from '../types.ts';

/** EMA series; index i holds the EMA ending at bar i (seeded with SMA). */
export function emaSeries(values: number[], period: number): number[] {
  if (period < 1) throw new Error('ema: period must be >= 1');
  const out: number[] = new Array(values.length).fill(Number.NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += values[i] ?? 0;
  seed /= period;
  out[period - 1] = seed;
  for (let i = period; i < values.length; i += 1) {
    out[i] = (values[i] ?? 0) * k + (out[i - 1] ?? seed) * (1 - k);
  }
  return out;
}

/** Wilder RSI series (0-100); needs period+1 closes before first value. */
export function rsiSeries(closes: number[], period = 14): number[] {
  if (period < 1) throw new Error('rsi: period must be >= 1');
  const out: number[] = new Array(closes.length).fill(Number.NaN);
  if (closes.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i += 1) {
    const d = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface Macd {
  line: number[];
  signal: number[];
  hist: number[];
}

/** MACD(12,26,9): line = EMA12−EMA26, signal = EMA9 of line. */
export function macdSeries(closes: number[], fast = 12, slow = 26, smooth = 9): Macd {
  const fastEma = emaSeries(closes, fast);
  const slowEma = emaSeries(closes, slow);
  const line = closes.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f != null && !Number.isNaN(f) && s != null && !Number.isNaN(s) ? f - s : Number.NaN;
  });
  const firstValid = line.findIndex((v) => !Number.isNaN(v));
  const signal = new Array(closes.length).fill(Number.NaN) as number[];
  if (firstValid >= 0) {
    const tail = line.slice(firstValid).map((v) => (Number.isNaN(v) ? 0 : v));
    const sigTail = emaSeries(tail, smooth);
    for (let i = 0; i < sigTail.length; i += 1) signal[firstValid + i] = sigTail[i] as number;
  }
  const hist = line.map((v, i) => {
    const s = signal[i];
    return v != null && !Number.isNaN(v) && s != null && !Number.isNaN(s) ? v - s : Number.NaN;
  });
  return { line, signal, hist };
}

/** ATR series (Wilder seed, causal per bar). */
export function atrSeries(candles: Candle[], period = 14): number[] {
  const out: number[] = new Array(candles.length).fill(Number.NaN);
  if (candles.length <= period) return out;
  let sum = 0;
  for (let i = 1; i <= period; i += 1) sum += trueRange(candles, i);
  let value = sum / period;
  out[period] = value;
  for (let i = period + 1; i < candles.length; i += 1) {
    value = (value * (period - 1) + trueRange(candles, i)) / period;
    out[i] = value;
  }
  return out;
}

/** Relative volume: volume / mean(volume, period) ending at the last bar. */
export function relativeVolume(volumes: number[], period = 20): number | null {
  if (volumes.length < period + 1) return null;
  const window = volumes.slice(volumes.length - period - 1, volumes.length - 1);
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const current = volumes[volumes.length - 1];
  if (!(mean > 0) || current == null) return null;
  return current / mean;
}
