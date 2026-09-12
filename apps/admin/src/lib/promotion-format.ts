import { DiscountType } from '../types/promotions';

function trimNumber(value: string): string {
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function formatDiscountLabel(promo: {
  discountType: DiscountType;
  value: string;
  maximumDiscountAmount?: string | null;
}): string {
  if (promo.discountType === 'PERCENTAGE') {
    const max = promo.maximumDiscountAmount ? ` (max ₹${trimNumber(promo.maximumDiscountAmount)})` : '';
    return `${trimNumber(promo.value)}%${max}`;
  }
  return `₹${trimNumber(promo.value)} off`;
}
