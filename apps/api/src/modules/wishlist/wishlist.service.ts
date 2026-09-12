import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { AddWishlistItemDto } from './dto/add-wishlist-item.dto';
import { MoveToCartDto } from './dto/move-to-cart.dto';

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

const WISHLIST_ITEM_INCLUDE = {
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      basePrice: true,
      images: { where: { isPrimary: true, isActive: true }, select: { url: true }, take: 1 },
    },
  },
  variant: { select: { id: true, sku: true, status: true, price: true } },
} as const;

/**
 * Phase 8 - Wishlist. One Wishlist per (storeId, userId) - §15 - created
 * lazily and idempotently via upsert() on that unique constraint, which is
 * atomic against concurrent first-access by construction (no advisory lock
 * needed, unlike Cart's own "one ACTIVE cart per user" rule, which can't be
 * a plain unique index because a user legitimately accumulates many
 * non-ACTIVE carts over time - a wishlist has no such lifecycle, so a
 * straightforward unique constraint is sufficient here).
 *
 * Guest wishlist (§20) was deliberately NOT implemented - documented
 * decision, not an oversight: this store's own checkout already requires
 * authentication with no guest path (see CheckoutController's own doc
 * comment - "No @Public() anywhere - checkout requires an authenticated
 * customer"), so an unauthenticated shopper already hits an auth wall at
 * purchase time regardless. Building a secure guest-token wishlist plus a
 * merge-on-login pipeline would be a substantial, independent feature
 * surface (mirroring Phase 4's guest cart in full) for a save-for-later
 * convenience feature explicitly marked optional by the Phase 8 prompt
 * itself ("implement guest wishlist support only if it fits cleanly...
 * if it would require introducing unnecessary complexity, document the
 * decision"). The wishlist requires authentication; the frontend prompts
 * an unauthenticated visitor to log in when they use the wishlist heart icon.
 */
@Injectable()
export class WishlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
  ) {}

  async getOrCreate(storeId: string, userId: string) {
    return this.prisma.wishlist.upsert({
      where: { storeId_userId: { storeId, userId } },
      update: {},
      create: { storeId, userId },
    });
  }

  async getWishlist(storeId: string, userId: string) {
    const wishlist = await this.getOrCreate(storeId, userId);
    const items = await this.prisma.wishlistItem.findMany({
      where: { wishlistId: wishlist.id },
      include: WISHLIST_ITEM_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return {
      id: wishlist.id,
      items: items.map((item) => this.toItemDetail(item)),
    };
  }

  async addItem(storeId: string, userId: string, dto: AddWishlistItemDto) {
    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, storeId, deletedAt: null } });
    if (!product || product.status !== 'ACTIVE') {
      throw new NotFoundException('Product not found or not currently available');
    }
    if (dto.variantId) {
      const variant = await this.prisma.productVariant.findFirst({ where: { id: dto.variantId, productId: dto.productId, deletedAt: null } });
      if (!variant || variant.status !== 'ACTIVE') {
        throw new NotFoundException('Variant not found or not currently available');
      }
    }

    const wishlist = await this.getOrCreate(storeId, userId);
    const itemKey = dto.variantId ?? dto.productId;

    try {
      await this.prisma.wishlistItem.create({
        data: { wishlistId: wishlist.id, productId: dto.productId, variantId: dto.variantId, itemKey },
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) throw error;
      // Already in the wishlist - idempotent (§26 "duplicate item race"):
      // adding something already there is a safe no-op, never a second row.
    }

    const item = await this.prisma.wishlistItem.findFirstOrThrow({
      where: { wishlistId: wishlist.id, itemKey },
      include: WISHLIST_ITEM_INCLUDE,
    });
    return this.toItemDetail(item);
  }

  async removeItem(storeId: string, userId: string, itemId: string) {
    const wishlist = await this.getOrCreate(storeId, userId);
    const result = await this.prisma.wishlistItem.deleteMany({ where: { id: itemId, wishlistId: wishlist.id } });
    if (result.count === 0) {
      // Never reveals whether the item belongs to another customer or
      // simply doesn't exist (§17).
      throw new NotFoundException('Wishlist item not found');
    }
    return { id: itemId };
  }

  /**
   * §18 - never a second cart implementation. Delegates entirely to the
   * existing CartService.resolveCart()/addItem(), which independently
   * re-validates product/variant status and current stock availability and
   * derives its own authoritative price - this method trusts none of that
   * itself.
   *
   * Phase 8 Final Micro-Correction: two concurrent move-to-cart requests for
   * the SAME wishlist item must behave as a single logical move, not two.
   * The item is now claimed atomically via a conditional deleteMany() BEFORE
   * calling CartService.addItem() - only one concurrent caller can ever see
   * count === 1 (the Postgres row lock on the delete serializes the race);
   * the loser sees count === 0 and is rejected as "not found" without ever
   * reaching CartService, so it can never double the cart quantity. If the
   * winner's own addItem() call then throws (inactive product, insufficient
   * stock), the wishlist item is re-created with its exact original id so a
   * failed move still leaves the customer's wishlist exactly as it was.
   */
  async moveToCart(storeId: string, actor: AuthenticatedUser, itemId: string, dto: MoveToCartDto) {
    const wishlist = await this.getOrCreate(storeId, actor.userId);
    const item = await this.prisma.wishlistItem.findFirst({ where: { id: itemId, wishlistId: wishlist.id } });
    if (!item) {
      throw new NotFoundException('Wishlist item not found');
    }

    const claim = await this.prisma.wishlistItem.deleteMany({ where: { id: item.id, wishlistId: wishlist.id } });
    if (claim.count === 0) {
      // A concurrent request already claimed (or a concurrent removeItem()
      // already deleted) this same wishlist item - never re-attempt the move.
      throw new NotFoundException('Wishlist item not found');
    }

    try {
      const { cartId } = await this.cartService.resolveCart({ storeId, userId: actor.userId });
      return await this.cartService.addItem(cartId, storeId, { productId: item.productId, variantId: item.variantId ?? undefined, quantity: dto.quantity ?? 1 }, actor.userId);
    } catch (error) {
      await this.prisma.wishlistItem.create({
        data: { id: item.id, wishlistId: item.wishlistId, productId: item.productId, variantId: item.variantId, itemKey: item.itemKey, createdAt: item.createdAt },
      });
      throw error;
    }
  }

  private toItemDetail(item: {
    id: string;
    productId: string;
    variantId: string | null;
    createdAt: Date;
    product: { id: string; name: string; slug: string; status: string; basePrice: { toFixed(n: number): string }; images: { url: string }[] };
    variant: { id: string; sku: string; status: string; price: { toFixed(n: number): string } } | null;
  }) {
    const isAvailable = item.product.status === 'ACTIVE' && (!item.variant || item.variant.status === 'ACTIVE');
    return {
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      productSlug: item.product.slug,
      variantId: item.variantId,
      variantSku: item.variant?.sku ?? null,
      price: (item.variant?.price ?? item.product.basePrice).toFixed(2),
      image: item.product.images[0]?.url ?? null,
      isAvailable,
      createdAt: item.createdAt,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === PRISMA_UNIQUE_CONSTRAINT_ERROR;
  }
}
