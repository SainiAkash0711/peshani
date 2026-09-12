import { DateRangePreset } from '../types/analytics';

export interface DateRangeSelection {
  preset: DateRangePreset;
  /** Only meaningful when preset === 'custom'; format YYYY-MM-DD. */
  from: string;
  /** Only meaningful when preset === 'custom'; format YYYY-MM-DD. */
  to: string;
}

export const DEFAULT_DATE_RANGE: DateRangeSelection = { preset: 'last30days', from: '', to: '' };

export const PRESET_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: 'Last 7 Days' },
  { value: 'last30days', label: 'Last 30 Days' },
  { value: 'last90days', label: 'Last 90 Days' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'lastMonth', label: 'Last Month' },
  { value: 'thisYear', label: 'This Year' },
  { value: 'custom', label: 'Custom' },
];

/**
 * True once the selection carries enough information for the backend to
 * resolve a window - always true for presets, only true for 'custom' once
 * both bounds have been chosen. Callers should gate their query's `enabled`
 * on this so an incomplete custom range never fires a malformed request.
 */
export function isRangeReady(range: DateRangeSelection): boolean {
  if (range.preset !== 'custom') return true;
  return Boolean(range.from) && Boolean(range.to);
}

/**
 * Builds the shared `preset`/`from`/`to` query params every analytics
 * endpoint accepts. Never compute date boundaries on the client - the
 * backend resolves the actual window and returns it in `range`.
 */
export function buildRangeParams(range: DateRangeSelection): URLSearchParams {
  const params = new URLSearchParams();
  params.set('preset', range.preset);
  if (range.preset === 'custom') {
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
  }
  return params;
}
