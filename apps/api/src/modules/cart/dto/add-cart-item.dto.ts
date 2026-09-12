import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

// Mirrors the MAX_PAGE_SIZE precedent in pagination-query.dto.ts - a plain
// module-level constant, not threaded through ConfigService, since decorator
// arguments are evaluated at class-definition time (after env vars load).
export const MAX_CART_ITEM_QUANTITY = parseInt(process.env.MAX_CART_ITEM_QUANTITY ?? '100', 10);

/**
 * Deliberately does NOT accept unitPrice/total/currency/userId/storeId - the
 * server is the sole authority on all of those (see CartService). Only the
 * product identity and the requested quantity ever come from the client.
 */
export class AddCartItemDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CART_ITEM_QUANTITY)
  quantity!: number;
}
