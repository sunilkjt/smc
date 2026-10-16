/** Small display formatters. No business logic here. */

export function fmtPx(value: number | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtCompact(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}

export function fmtPct(value: number | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function dayChangePct(markPx?: number, prevDayPx?: number): number | undefined {
  if (markPx == null || prevDayPx == null || prevDayPx === 0) return undefined;
  return ((markPx - prevDayPx) / prevDayPx) * 100;
}

/** Human age of a timestamp, e.g. "42s ago". */
export function timeAgo(ts: number | null, now: number = Date.now()): string {
  if (ts == null) return 'never';
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
