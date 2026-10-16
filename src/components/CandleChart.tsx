import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '../lib/types.ts';

export interface ChartLine {
  price: number;
  color: string;
  title: string;
  dashed?: boolean;
}

export interface ChartMarker {
  time: number;
  position: 'aboveBar' | 'belowBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  text: string;
}

interface Props {
  candles: Candle[];
  height?: number;
  lines?: ChartLine[];
  markers?: ChartMarker[];
}

/** Minimal dark candlestick chart. Closed candles only — pass provisional separately. */
export default function CandleChart({ candles, height = 320, lines = [], markers = [] }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
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
    markersRef.current = createSeriesMarkers(seriesRef.current, []);
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
      markersRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const markersApi = markersRef.current;
    if (!chart || !series || !markersApi) return;
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
    const plotted: Array<SeriesMarker<UTCTimestamp>> = [...markers]
      .sort((a, b) => a.time - b.time)
      .map((m) => ({
        time: Math.floor(m.time / 1000) as UTCTimestamp,
        position: m.position,
        color: m.color,
        shape: m.shape,
        text: m.text,
      }));
    markersApi.setMarkers(plotted);
    chart.timeScale().scrollToRealTime();
  }, [candles, lines, markers]);

  return <div ref={hostRef} className="w-full" style={{ height }} />;
}
