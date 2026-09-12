import type { Availability } from '../types/catalog';

export function formatPrice(amount: string, currencySymbol = '₹'): string {
  const value = Number(amount);
  return `${currencySymbol}${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  IN_STOCK: 'In Stock',
  LOW_STOCK: 'Low Stock',
  OUT_OF_STOCK: 'Out of Stock',
};

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatRelativeTime(isoDate: string): string {
  const seconds = (new Date(isoDate).getTime() - Date.now()) / 1000;
  const absSeconds = Math.abs(seconds);

  if (absSeconds < 60) return 'just now';

  for (const [unit, unitSeconds] of RELATIVE_UNITS) {
    if (absSeconds >= unitSeconds) {
      return relativeTimeFormatter.format(Math.round(seconds / unitSeconds), unit);
    }
  }
  return 'just now';
}
