import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '../lib/types.ts';

interface Props {
  candles: Candle[];
  height?: number;
}

/** Minimal dark candlestick chart. Closed candles only — pass provisional separately. */
export default function CandleChart({ candles, height = 320 }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      height,
      layout: { background: { color: 'transparent' }, textColor: '#8b94a3' },
      grid: { vertLines: { color: '#1f2630' }, horzLines: { color: '#1f2630' } },
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#22c07a',
      downColor: '#e5484d',
      wickUpColor: '#22c07a',
      wickDownColor: '#e5484d',
      borderVisible: false,
    });
    chartRef.current = chart;
    const resize = () => chart.applyOptions({ width: host.clientWidth });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    series.setData(
      candles.map((c) => ({
        time: Math.floor(c.time / 1000) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    chart.timeScale().scrollToRealTime();
  }, [candles]);

  return <div ref={hostRef} className="w-full" style={{ height }} />;
}
