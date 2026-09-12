import { AnalyticsRange } from '../types/analytics';

/** Store currency is INR for now - no multi-currency support in the analytics API yet. */
const CURRENCY_SYMBOL = '₹';

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return `${CURRENCY_SYMBOL}0.00`;
  }
  return `${CURRENCY_SYMBOL}${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0';
  return value.toLocaleString();
}

/** For a 0-1 fraction (e.g. payments' `successRate`) - multiplies by 100 before formatting. */
export function formatPercent(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return '—';
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** For a value already expressed on a 0-100 scale (e.g. `deliveredPercentage`, category/brand
 * `percentage` fields) - appends "%" without re-scaling. */
export function formatPercentValue(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

/** Formats a duration given in seconds as a compact human string, e.g. "2h 15m" or "3d 4h". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds) || seconds < 0) {
    return '—';
  }
  const total = Math.round(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

/** Coerces a recharts tooltip/axis value (which may be string | number | array | undefined)
 * down to a plain number for our formatters. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function formatEnumLabel(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

/** Turns a dynamic transition key like "CONFIRMED_TO_PROCESSING" into "Confirmed → Processing". */
export function formatTransitionLabel(key: string): string {
  const marker = '_TO_';
  const idx = key.indexOf(marker);
  if (idx === -1) return formatEnumLabel(key);
  const from = key.slice(0, idx);
  const to = key.slice(idx + marker.length);
  return `${formatEnumLabel(from)} → ${formatEnumLabel(to)}`;
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Renders the `range` block every date-filtered analytics response includes, so the admin can
 * always see exactly what window is being reported. */
export function formatRangeCaption(range: Pick<AnalyticsRange, 'from' | 'to' | 'timezone'>): string {
  return `${formatDateShort(range.from)} – ${formatDateShort(range.to)} · ${range.timezone}`;
}
