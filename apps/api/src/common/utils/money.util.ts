import { Prisma } from '@prisma/client';

/**
 * Converts a decimal-string amount (e.g. "999.50") to the provider's
 * smallest currency unit (e.g. 99950 paise for INR) using exact decimal
 * arithmetic (Prisma.Decimal / decimal.js), never a plain JS float
 * multiplication - `19.1 * 100` is `1909.9999999999998` in native floats,
 * which is exactly the class of bug this phase must never ship (see the
 * Phase 5 report's financial-precision section).
 */
export function toMinorUnits(amount: Prisma.Decimal | string): number {
  return new Prisma.Decimal(amount).times(100).toNumber();
}
