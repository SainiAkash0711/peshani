import type { Availability } from '../types/catalog';
import { AVAILABILITY_LABEL } from '../lib/format';

const CLASS_BY_AVAILABILITY: Record<Availability, string> = {
  IN_STOCK: 'badge badge--in-stock',
  LOW_STOCK: 'badge badge--low-stock',
  OUT_OF_STOCK: 'badge badge--out-of-stock',
};

export function AvailabilityBadge({ availability }: { availability: Availability }) {
  return <span className={CLASS_BY_AVAILABILITY[availability]}>{AVAILABILITY_LABEL[availability]}</span>;
}
