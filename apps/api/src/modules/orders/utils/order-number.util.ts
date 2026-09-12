import { randomBytes } from 'node:crypto';

/**
 * PES-YYYYMMDD-XXXXXXXX - a customer-facing reference, never a raw UUID.
 * The random suffix (not a bare counter/timestamp) makes two orders placed
 * in the same millisecond distinguishable, and OrderService retries with a
 * fresh suffix on the rare P2002 collision rather than trusting this alone
 * to be globally unique (see OrderService.generateUniqueOrderNumber).
 */
export function generateOrderNumber(): string {
  const now = new Date();
  const datePart = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  const randomPart = randomBytes(4).toString('hex').toUpperCase();
  return `PES-${datePart}-${randomPart}`;
}
