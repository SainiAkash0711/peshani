import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InventorySum } from './utils/availability.util';

function key(productId: string, variantId: string | null): string {
  return `${productId}:${variantId ?? 'simple'}`;
}

/**
 * Bulk-loads inventory sums for a batch of products/variants in a single
 * query, so a product listing page never issues one inventory query per row
 * (N+1). Only ever reads availableQuantity/lowStockThreshold - the two
 * columns computeAvailability() needs - never onHandQuantity, reservedQuantity,
 * warehouse identity, or reservation rows, all of which stay internal to the
 * admin inventory module.
 */
@Injectable()
export class StorefrontInventoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sums available/threshold across every ACTIVE warehouse, per (productId, variantId|simple). */
  async getBulkAvailability(storeId: string, productIds: string[]): Promise<Map<string, InventorySum>> {
    if (productIds.length === 0) return new Map();

    const rows = await this.prisma.inventoryItem.groupBy({
      by: ['productId', 'variantId'],
      where: { storeId, productId: { in: productIds }, warehouse: { isActive: true } },
      _sum: { availableQuantity: true, lowStockThreshold: true },
    });

    const map = new Map<string, InventorySum>();
    for (const row of rows) {
      map.set(key(row.productId, row.variantId), {
        available: row._sum.availableQuantity ?? 0,
        threshold: row._sum.lowStockThreshold ?? 0,
      });
    }
    return map;
  }
}
