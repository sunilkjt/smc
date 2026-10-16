import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  createChart,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '../lib/types.ts';

export interface ChartLine {
  price: number;
  color: string;
  title: string;
  dashed?: boolean;
}

interface Props {
  candles: Candle[];
  height?: number;
  lines?: ChartLine[];
}

/** Minimal dark candlestick chart. Closed candles only — pass provisional separately. */
export default function CandleChart({ candles, height = 320, lines = [] }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);

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
    // Rebuild overlays (entry / stop / targets) from scratch.
    for (const old of linesRef.current) {
      try {
        series.removePriceLine(old);
      } catch {
        /* already removed */
      }
    }
    linesRef.current = lines.map((l) =>
      series.createPriceLine({
        price: l.price,
        color: l.color,
        lineWidth: 1,
        lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title: l.title,
      }),
    );
    chart.timeScale().scrollToRealTime();
  }, [candles, lines]);

  return <div ref={hostRef} className="w-full" style={{ height }} />;
}
