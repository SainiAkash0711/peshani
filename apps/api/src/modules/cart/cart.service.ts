import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { StorefrontInventoryService } from '../storefront/storefront-inventory.service';
import { AppConfig } from '../../config/configuration';
import { generateGuestToken, hashGuestToken } from './utils/guest-token.util';
import { AddCartItemDto, MAX_CART_ITEM_QUANTITY } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartItemStatus } from './types/cart-item-status.type';

export interface CartActor {
  storeId: string;
  userId?: string;
  guestToken?: string;
}

export interface MergeResult {
  merged: string[];
  removed: { productId: string; variantId: string | null; reason: string }[];
  quantityAdjusted: { productId: string; variantId: string | null; requestedQuantity: number; adjustedQuantity: number }[];
  priceChanged: { productId: string; variantId: string | null; oldPrice: string; newPrice: string }[];
}

const CART_ITEM_INCLUDE = {
  product: { select: { id: true, name: true, slug: true, status: true, productType: true, basePrice: true, deletedAt: true, images: { where: { isPrimary: true, isActive: true }, take: 1, select: { url: true, altText: true } } } },
  variant: {
    select: {
      id: true,
      status: true,
      price: true,
      deletedAt: true,
      image: true,
      attributeValues: { select: { attributeValue: { select: { value: true, attribute: { select: { name: true } } } } } },
    },
  },
} satisfies Prisma.CartItemInclude;

type CartItemRow = Prisma.CartItemGetPayload<{ include: typeof CART_ITEM_INCLUDE }>;

/**
 * PHASE 4 - CART FOUNDATION.
 *
 * Cart quantity is intent, not a hold: adding to cart NEVER creates a
 * StockReservation (see section 41 of the master prompt) - availability is
 * only ever checked, never reserved, here. Reservation is a future
 * checkout-phase concern.
 *
 * Price authority: CartItem.unitPriceSnapshot is refreshed against the live
 * product/variant price on every read/mutation in this service (never
 * trusted from the client, and never permanently authoritative itself) -
 * see refreshAndValidateItems().
 */
@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly storeSettingsService: StoreSettingsService,
    private readonly inventoryService: StorefrontInventoryService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  // ---------------------------------------------------------------------
  // Cart resolution (guest or authenticated)
  // ---------------------------------------------------------------------

  /**
   * Finds or creates "the current cart" for this actor. Never trusts a
   * client-supplied userId/storeId - userId comes only from the JWT
   * (already resolved by OptionalJwtAuthGuard before this is called), and
   * storeId only from StoreSettingsService.getDefaultStore().
   *
   * Returns `newGuestToken` whenever a fresh guest identity had to be
   * minted (no token supplied at all, or the supplied one no longer
   * resolves to an active cart) - callers must surface this to the client
   * so it can be stored as the new guest-cart cookie.
   */
  async resolveCart(actor: CartActor): Promise<{ cartId: string; newGuestToken?: string }> {
    if (actor.userId) {
      return { cartId: await this.resolveUserCart(actor.storeId, actor.userId) };
    }
    return this.resolveGuestCart(actor.storeId, actor.guestToken);
  }

  private async resolveUserCart(storeId: string, userId: string): Promise<string> {
    // Prisma's default interactive-transaction budget (maxWait 2s to acquire
    // a pool connection, timeout 5s to complete) is tight for the most
    // business-critical path in the app - a burst of concurrent checkouts
    // (e.g. a flash sale) or a brief real-world connection-pool/I/O stall
    // can exceed it even though this transaction's own work (one advisory
    // lock plus a couple of tiny queries) is normally sub-millisecond.
    // Confirmed via real, repeated Phase 14 regression runs: under genuine
    // host resource contention, 5 concurrent checkouts occasionally hit
    // "Transaction API error: Transaction not found... obtained before
    // disconnecting" - the default timeout expiring mid-flight. Widening
    // the budget costs nothing in the fast common case and gives real
    // headroom under load; it does not change what the transaction does.
    return this.prisma.$transaction(async (tx) => {
      // Serializes concurrent first-time-cart-creation for the same user -
      // "one ACTIVE cart per user" can't be a plain unique index (a user
      // legitimately accumulates many non-ACTIVE carts over time), so this
      // closes the check-then-create race the same way
      // InventoryService.initialize() does for InventoryItem (Phase 2F).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cart:user:${storeId}:${userId}`}))`;

      const existing = await tx.cart.findFirst({
        where: { storeId, userId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      });
      if (existing && existing.expiresAt > new Date()) {
        return existing.id;
      }
      if (existing) {
        await tx.cart.update({ where: { id: existing.id }, data: { status: 'EXPIRED' } });
      }

      const currency = await this.resolveCurrency(storeId);
      const days = this.configService.get('cart', { infer: true }).userCartExpiryDays;
      const created = await tx.cart.create({
        data: { storeId, userId, currency, expiresAt: new Date(Date.now() + days * 86_400_000) },
      });
      return created.id;
    }, { maxWait: 10_000, timeout: 15_000 });
  }

  private async resolveGuestCart(storeId: string, guestToken?: string): Promise<{ cartId: string; newGuestToken?: string }> {
    if (guestToken) {
      const existing = await this.prisma.cart.findFirst({
        where: { storeId, guestTokenHash: hashGuestToken(guestToken), status: 'ACTIVE' },
      });
      if (existing && existing.expiresAt > new Date()) {
        return { cartId: existing.id };
      }
    }

    const currency = await this.resolveCurrency(storeId);
    const days = this.configService.get('cart', { infer: true }).guestCartExpiryDays;
    const newGuestToken = generateGuestToken();
    const created = await this.prisma.cart.create({
      data: {
        storeId,
        guestTokenHash: hashGuestToken(newGuestToken),
        currency,
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });
    return { cartId: created.id, newGuestToken };
  }

  private async resolveCurrency(storeId: string): Promise<string> {
    const settings = await this.storeSettingsService.getAllSettings(storeId);
    return settings.currency ?? 'INR';
  }

  // ---------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------

  async getCart(cartId: string) {
    return this.loadAndRefreshCart(cartId);
  }

  /** Same revalidation pass as getCart(), exposed as its own endpoint for an explicit pre-checkout check. */
  async validateCart(cartId: string) {
    return this.loadAndRefreshCart(cartId);
  }

  // ---------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------

  async addItem(cartId: string, storeId: string, dto: AddCartItemDto, userId?: string) {
    const { authoritativePrice } = await this.validateProductAndVariant(storeId, dto.productId, dto.variantId);
    const itemKey = dto.variantId ?? dto.productId;
    const cart = await this.getStoreScopedCartOrThrow(cartId, storeId);

    const item = await this.prisma.$transaction(async (tx) => {
      // Atomic upsert on (cartId, itemKey): Postgres serializes two
      // concurrent first-time inserts of the SAME line natively (the second
      // blocks on the unique index, then re-applies as an UPDATE once the
      // first commits) - the exact "two simultaneous adds of the same
      // product -> quantity=2, never 1" scenario this phase must prove.
      // Unlike InventoryItem, no advisory lock is needed here: itemKey is
      // never NULL, so the unique constraint alone fully closes the race.
      const upserted = await tx.cartItem.upsert({
        where: { cartId_itemKey: { cartId, itemKey } },
        create: {
          cartId,
          productId: dto.productId,
          variantId: dto.variantId,
          itemKey,
          quantity: dto.quantity,
          unitPriceSnapshot: authoritativePrice,
          currency: cart.currency,
        },
        update: { quantity: { increment: dto.quantity }, unitPriceSnapshot: authoritativePrice },
      });

      if (upserted.quantity > MAX_CART_ITEM_QUANTITY) {
        throw new BadRequestException(`Quantity cannot exceed ${MAX_CART_ITEM_QUANTITY} for a single cart line`);
      }

      const availability = await this.inventoryService.getBulkAvailability(storeId, [dto.productId]);
      const sum = availability.get(`${dto.productId}:${dto.variantId ?? 'simple'}`) ?? { available: 0, threshold: 0 };
      if (upserted.quantity > sum.available) {
        // Rolls back the upsert above - the whole add is rejected, not
        // silently clamped (see master prompt section 12: "if quantity
        // exceeds stock, reject safely").
        throw new ConflictException(`Only ${sum.available} unit(s) available for this item`);
      }

      return upserted;
    });

    if (userId) {
      await this.auditLogService.record({
        storeId,
        userId,
        action: 'CartItemAdded',
        entityType: 'CartItem',
        entityId: item.id,
        metadata: { productId: dto.productId, variantId: dto.variantId, quantity: dto.quantity },
      });
    }

    return this.loadAndRefreshCart(cartId);
  }

  async updateItemQuantity(cartId: string, storeId: string, itemId: string, dto: UpdateCartItemDto, userId?: string) {
    const existing = await this.getScopedItemOrThrow(cartId, itemId);
    const { authoritativePrice } = await this.validateProductAndVariant(storeId, existing.productId, existing.variantId ?? undefined);

    const availability = await this.inventoryService.getBulkAvailability(storeId, [existing.productId]);
    const sum = availability.get(`${existing.productId}:${existing.variantId ?? 'simple'}`) ?? { available: 0, threshold: 0 };
    if (dto.quantity > sum.available) {
      throw new ConflictException(`Only ${sum.available} unit(s) available for this item`);
    }

    await this.prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: dto.quantity, unitPriceSnapshot: authoritativePrice },
    });

    if (userId) {
      await this.auditLogService.record({
        storeId,
        userId,
        action: 'CartItemUpdated',
        entityType: 'CartItem',
        entityId: existing.id,
        metadata: { before: { quantity: existing.quantity }, after: { quantity: dto.quantity } },
      });
    }

    return this.loadAndRefreshCart(cartId);
  }

  /** Idempotent - removing an item that's already gone (or never existed) is a no-op, not an error. */
  async removeItem(cartId: string, storeId: string, itemId: string, userId?: string) {
    const existing = await this.prisma.cartItem.findFirst({ where: { id: itemId, cartId } });
    if (existing) {
      await this.prisma.cartItem.delete({ where: { id: existing.id } });
      if (userId) {
        await this.auditLogService.record({
          storeId,
          userId,
          action: 'CartItemRemoved',
          entityType: 'CartItem',
          entityId: existing.id,
          metadata: { productId: existing.productId, variantId: existing.variantId },
        });
      }
    }
    return this.loadAndRefreshCart(cartId);
  }

  /** Idempotent - clearing an already-empty cart is a no-op. */
  async clearCart(cartId: string, storeId: string, userId?: string) {
    const { count } = await this.prisma.cartItem.deleteMany({ where: { cartId } });
    if (userId && count > 0) {
      await this.auditLogService.record({
        storeId,
        userId,
        action: 'CartCleared',
        entityType: 'Cart',
        entityId: cartId,
        metadata: { itemsRemoved: count },
      });
    }
    return this.loadAndRefreshCart(cartId);
  }

  // ---------------------------------------------------------------------
  // Guest -> customer merge (called from AuthService.login())
  // ---------------------------------------------------------------------

  async mergeGuestCartIntoUser(storeId: string, userId: string, rawGuestToken: string): Promise<MergeResult | null> {
    const guestCart = await this.prisma.cart.findFirst({
      where: { storeId, guestTokenHash: hashGuestToken(rawGuestToken), status: 'ACTIVE' },
      include: { items: true },
    });
    if (!guestCart || guestCart.expiresAt < new Date() || guestCart.items.length === 0) {
      if (guestCart) await this.prisma.cart.update({ where: { id: guestCart.id }, data: { status: 'MERGED' } });
      return null;
    }

    const userCartId = await this.resolveUserCart(storeId, userId);
    const result: MergeResult = { merged: [], removed: [], quantityAdjusted: [], priceChanged: [] };

    await this.prisma.$transaction(async (tx) => {
      for (const guestItem of guestCart.items) {
        let validation: { authoritativePrice: Prisma.Decimal } | null = null;
        try {
          validation = await this.validateProductAndVariant(storeId, guestItem.productId, guestItem.variantId ?? undefined, tx);
        } catch {
          result.removed.push({ productId: guestItem.productId, variantId: guestItem.variantId, reason: 'Product or variant is no longer available' });
          continue;
        }

        const availability = await this.inventoryService.getBulkAvailability(storeId, [guestItem.productId]);
        const sum = availability.get(`${guestItem.productId}:${guestItem.variantId ?? 'simple'}`) ?? { available: 0, threshold: 0 };

        const existingUserItem = await tx.cartItem.findFirst({ where: { cartId: userCartId, itemKey: guestItem.itemKey } });
        const requestedQuantity = (existingUserItem?.quantity ?? 0) + guestItem.quantity;
        const cappedQuantity = Math.min(requestedQuantity, sum.available, MAX_CART_ITEM_QUANTITY);

        if (cappedQuantity <= 0) {
          result.removed.push({ productId: guestItem.productId, variantId: guestItem.variantId, reason: 'Out of stock' });
          continue;
        }
        if (cappedQuantity !== requestedQuantity) {
          result.quantityAdjusted.push({ productId: guestItem.productId, variantId: guestItem.variantId, requestedQuantity, adjustedQuantity: cappedQuantity });
        }

        const priceString = validation.authoritativePrice.toFixed(2);
        if (existingUserItem && existingUserItem.unitPriceSnapshot.toFixed(2) !== priceString) {
          result.priceChanged.push({ productId: guestItem.productId, variantId: guestItem.variantId, oldPrice: existingUserItem.unitPriceSnapshot.toFixed(2), newPrice: priceString });
        }

        await tx.cartItem.upsert({
          where: { cartId_itemKey: { cartId: userCartId, itemKey: guestItem.itemKey } },
          create: {
            cartId: userCartId,
            productId: guestItem.productId,
            variantId: guestItem.variantId,
            itemKey: guestItem.itemKey,
            quantity: cappedQuantity,
            unitPriceSnapshot: validation.authoritativePrice,
            currency: guestItem.currency,
          },
          update: { quantity: cappedQuantity, unitPriceSnapshot: validation.authoritativePrice },
        });
        result.merged.push(guestItem.itemKey);
      }

      await tx.cartItem.deleteMany({ where: { cartId: guestCart.id } });
      await tx.cart.update({ where: { id: guestCart.id }, data: { status: 'MERGED' } });
    });

    await this.auditLogService.record({
      storeId,
      userId,
      action: 'CartMerged',
      entityType: 'Cart',
      entityId: userCartId,
      metadata: { mergedCount: result.merged.length, removedCount: result.removed.length, adjustedCount: result.quantityAdjusted.length },
    });

    return result;
  }

  // ---------------------------------------------------------------------
  // Cleanup (no scheduler infrastructure exists yet - see Phase 4 report;
  // this is the clean service method a future cron job would call)
  // ---------------------------------------------------------------------

  async sweepExpiredCarts(): Promise<number> {
    const { count } = await this.prisma.cart.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    return count;
  }

  // ---------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------

  private async getStoreScopedCartOrThrow(cartId: string, storeId: string) {
    const cart = await this.prisma.cart.findFirst({ where: { id: cartId, storeId } });
    if (!cart) {
      throw new NotFoundException('Cart not found');
    }
    return cart;
  }

  private async getScopedItemOrThrow(cartId: string, itemId: string) {
    const item = await this.prisma.cartItem.findFirst({ where: { id: itemId, cartId } });
    if (!item) {
      throw new NotFoundException('Cart item not found');
    }
    return item;
  }

  /**
   * The single point where a product/variant is confirmed sellable and its
   * authoritative price is read. Every mutation goes through this - the
   * client's own claims about product name, price, or availability are
   * never consulted.
   */
  private async validateProductAndVariant(
    storeId: string,
    productId: string,
    variantId: string | undefined,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<{ authoritativePrice: Prisma.Decimal }> {
    const product = await tx.product.findFirst({ where: { id: productId, storeId, deletedAt: null } });
    if (!product || product.status !== 'ACTIVE') {
      throw new NotFoundException('Product is not available');
    }

    if (product.productType === 'VARIABLE') {
      if (!variantId) {
        throw new BadRequestException('A variant must be selected for this product');
      }
      const variant = await tx.productVariant.findFirst({ where: { id: variantId, productId, deletedAt: null } });
      if (!variant || variant.status !== 'ACTIVE') {
        throw new NotFoundException('Variant is not available');
      }
      return { authoritativePrice: variant.price };
    }

    if (variantId) {
      throw new BadRequestException('A simple product does not take a variant');
    }
    return { authoritativePrice: product.basePrice };
  }

  /** Loads every item, refreshes its price snapshot + validation status, and returns the safe response DTO. */
  private async loadAndRefreshCart(cartId: string) {
    const cart = await this.prisma.cart.findUniqueOrThrow({ where: { id: cartId } });
    const items = await this.prisma.cartItem.findMany({
      where: { cartId },
      orderBy: { createdAt: 'asc' },
      include: CART_ITEM_INCLUDE,
    });

    const productIds = Array.from(new Set(items.map((i) => i.productId)));
    const availability = await this.inventoryService.getBulkAvailability(cart.storeId, productIds);

    const refreshed = await Promise.all(items.map((item) => this.refreshItem(item, availability)));

    let subtotal = 0;
    const responseItems = refreshed.map(({ item, status, currentPrice, availableQuantity }) => {
      const lineTotal = Number(currentPrice) * item.quantity;
      if (status === 'VALID' || status === 'PRICE_CHANGED' || status === 'INSUFFICIENT_STOCK') {
        subtotal += lineTotal;
      }
      return {
        id: item.id,
        product: {
          id: item.product.id,
          name: item.product.name,
          slug: item.product.slug,
          image: item.product.images[0]?.url ?? null,
        },
        variant: item.variant
          ? {
              id: item.variant.id,
              attributes: item.variant.attributeValues.map((av) => `${av.attributeValue.attribute.name}: ${av.attributeValue.value}`),
            }
          : null,
        quantity: item.quantity,
        unitPrice: currentPrice,
        lineTotal: lineTotal.toFixed(2),
        status,
        priceChanged: status === 'PRICE_CHANGED',
        // Only surfaced for a line the customer has already selected and
        // that is now short on stock - actionable "reduce to N" information,
        // not the blanket raw-inventory exposure Phase 3 forbids for
        // anonymous catalog browsing.
        ...(status === 'INSUFFICIENT_STOCK' || status === 'OUT_OF_STOCK' ? { availableQuantity } : {}),
      };
    });

    return {
      id: cart.id,
      currency: cart.currency,
      items: responseItems,
      itemCount: responseItems.reduce((sum, i) => sum + i.quantity, 0),
      subtotal: subtotal.toFixed(2),
      updatedAt: cart.updatedAt,
    };
  }

  private async refreshItem(
    item: CartItemRow,
    availability: Map<string, { available: number; threshold: number }>,
  ): Promise<{ item: CartItemRow; status: CartItemStatus; currentPrice: string; availableQuantity?: number }> {
    if (!item.product || item.product.deletedAt || item.product.status !== 'ACTIVE') {
      return { item, status: 'PRODUCT_UNAVAILABLE', currentPrice: item.unitPriceSnapshot.toFixed(2) };
    }

    let authoritativePrice: Prisma.Decimal;
    if (item.product.productType === 'VARIABLE') {
      if (!item.variant || item.variant.deletedAt || item.variant.status !== 'ACTIVE') {
        return { item, status: 'VARIANT_UNAVAILABLE', currentPrice: item.unitPriceSnapshot.toFixed(2) };
      }
      authoritativePrice = item.variant.price;
    } else {
      authoritativePrice = item.product.basePrice;
    }

    const sum = availability.get(`${item.productId}:${item.variantId ?? 'simple'}`) ?? { available: 0, threshold: 0 };
    const priceString = authoritativePrice.toFixed(2);
    const priceChanged = priceString !== item.unitPriceSnapshot.toFixed(2);

    if (priceChanged) {
      await this.prisma.cartItem.update({ where: { id: item.id }, data: { unitPriceSnapshot: authoritativePrice } });
    }

    if (sum.available <= 0) {
      return { item, status: 'OUT_OF_STOCK', currentPrice: priceString, availableQuantity: sum.available };
    }
    if (item.quantity > sum.available) {
      return { item, status: 'INSUFFICIENT_STOCK', currentPrice: priceString, availableQuantity: sum.available };
    }
    if (priceChanged) {
      return { item, status: 'PRICE_CHANGED', currentPrice: priceString };
    }
    return { item, status: 'VALID', currentPrice: priceString };
  }
}
