export type PublicAvailability = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

/**
 * Derives a safe, storefront-facing tri-state from raw inventory numbers.
 * Never returns (or is built from anything that could be reverse-engineered
 * into) a real quantity - only the enum crosses the public API boundary.
 *
 * A SKU with no InventoryItem row at all (available=0, threshold=0) is
 * treated as OUT_OF_STOCK: no inventory record means it has never been
 * stocked anywhere sellable, which is not the same as "in stock".
 */
export function computeAvailability(available: number, threshold: number): PublicAvailability {
  if (available <= 0) return 'OUT_OF_STOCK';
  if (available <= threshold) return 'LOW_STOCK';
  return 'IN_STOCK';
}

export interface InventorySum {
  available: number;
  threshold: number;
}

export function sumInventory(rows: InventorySum[]): InventorySum {
  return rows.reduce(
    (acc, row) => ({ available: acc.available + row.available, threshold: acc.threshold + row.threshold }),
    { available: 0, threshold: 0 },
  );
}

/**
 * Combines several already-computed per-variant availabilities into one
 * product-level badge (used on listing cards for VARIABLE products, where
 * showing one badge per card is simpler than a mini-matrix). IN_STOCK wins if
 * any variant is sellable, then LOW_STOCK, else OUT_OF_STOCK - a customer
 * should never see "out of stock" on a card that has a purchasable variant.
 */
export function combineAvailability(statuses: PublicAvailability[]): PublicAvailability {
  if (statuses.some((s) => s === 'IN_STOCK')) return 'IN_STOCK';
  if (statuses.some((s) => s === 'LOW_STOCK')) return 'LOW_STOCK';
  return 'OUT_OF_STOCK';
}
