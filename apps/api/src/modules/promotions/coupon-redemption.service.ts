import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { DiscountEngineService, DiscountLine, PromotionTargeting } from './discount-engine.service';
import { normalizeCouponCode } from './coupons.service';

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

const REDEMPTION_PROMOTION_INCLUDE = {
  products: { select: { productId: true, isExcluded: true } },
  categories: { select: { categoryId: true, isExcluded: true } },
  brands: { select: { brandId: true, isExcluded: true } },
} satisfies Prisma.PromotionInclude;

export interface CouponReservationResult {
  couponId: string;
  promotionId: string;
  couponCodeSnapshot: string;
  promotionNameSnapshot: string;
  eligibleAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
}

/**
 * Phase 7 §9/§30-§37 - the ONE place a coupon's RESERVED -> CONSUMED /
 * RESERVED -> RELEASED state machine is implemented; CheckoutService,
 * PaymentService, and OrderStatusService each call these methods at their
 * own existing lifecycle event rather than reimplementing any of this
 * logic themselves.
 */
@Injectable()
export class CouponRedemptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly discountEngine: DiscountEngineService,
  ) {}

  /**
   * Read-only preview (no reservation, no usage-limit enforcement) for the
   * customer-facing validate endpoint - re-validated in full by reserve()
   * at actual checkout regardless (§26), so a preview that goes stale
   * between "Apply" and "Pay Now" can never itself cause an incorrect charge.
   */
  async preview(storeId: string, code: string, lines: DiscountLine[], subtotal: Prisma.Decimal) {
    const coupon = await this.prisma.coupon.findFirst({
      where: { storeId, normalizedCode: normalizeCouponCode(code), isActive: true, deletedAt: null },
      include: { promotion: { include: REDEMPTION_PROMOTION_INCLUDE } },
    });
    if (!coupon || !coupon.promotion || coupon.promotion.deletedAt || !coupon.promotion.isActive) {
      throw new NotFoundException('Coupon not found or no longer valid');
    }
    this.assertDateWindow(coupon);

    const targeting = this.toTargeting(coupon.promotion);
    const calculation = this.discountEngine.calculate(
      {
        discountType: coupon.promotion.discountType,
        value: coupon.promotion.value,
        maximumDiscountAmount: coupon.promotion.maximumDiscountAmount,
        minimumOrderAmount: coupon.promotion.minimumOrderAmount,
      },
      targeting,
      lines,
      subtotal,
    );
    if (!calculation.eligible) {
      throw new ConflictException(calculation.reason);
    }

    return {
      couponCode: coupon.code,
      promotionName: coupon.promotion.name,
      discountType: coupon.promotion.discountType,
      discountAmount: calculation.discountAmount,
    };
  }

  /**
   * Phase 1 of the AUTHORITATIVE reserve step (§26/§59) - MUST be called
   * with the same `tx` as the rest of checkout's Phase A transaction, and
   * BEFORE the Order exists (the Order's own discountAmount/couponId/
   * snapshot columns are populated from this result at creation time - see
   * CheckoutService). Re-validates everything from scratch (never trusts a
   * prior preview), then acquires a per-coupon advisory lock so concurrent
   * redemption attempts for the SAME coupon serialize (§32/§33), and checks
   * usage limits by COUNTING RESERVED+CONSUMED rows - a reservation
   * genuinely holds a usage slot until released, so it must count even
   * before payment succeeds. The lock is transaction-scoped (released only
   * at commit/rollback), so it remains held across the gap between this
   * call and the later createRedemptionRecord() call within the SAME
   * transaction - no other transaction can interleave and redeem the same
   * coupon in between.
   */
  async evaluate(
    tx: Prisma.TransactionClient,
    params: { storeId: string; userId: string; code: string; lines: DiscountLine[]; subtotal: Prisma.Decimal },
  ): Promise<CouponReservationResult> {
    const coupon = await tx.coupon.findFirst({
      where: { storeId: params.storeId, normalizedCode: normalizeCouponCode(params.code), isActive: true, deletedAt: null },
      include: { promotion: { include: REDEMPTION_PROMOTION_INCLUDE } },
    });
    if (!coupon || !coupon.promotion || coupon.promotion.deletedAt || !coupon.promotion.isActive) {
      throw new ConflictException('Coupon is not valid');
    }
    this.assertDateWindow(coupon);

    const targeting = this.toTargeting(coupon.promotion);
    const calculation = this.discountEngine.calculate(
      {
        discountType: coupon.promotion.discountType,
        value: coupon.promotion.value,
        maximumDiscountAmount: coupon.promotion.maximumDiscountAmount,
        minimumOrderAmount: coupon.promotion.minimumOrderAmount,
      },
      targeting,
      params.lines,
      params.subtotal,
    );
    if (!calculation.eligible) {
      throw new ConflictException(calculation.reason);
    }

    // §32/§33 - serializes every concurrent redemption attempt for this
    // EXACT coupon (any customer, any order) - acquired inside this same
    // transaction, released automatically at commit/rollback.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`coupon:redeem:${coupon.id}`}))`;

    if (coupon.usageLimit !== null) {
      const globalUsage = await tx.couponRedemption.count({ where: { couponId: coupon.id, status: { in: ['RESERVED', 'CONSUMED'] } } });
      if (globalUsage >= coupon.usageLimit) {
        throw new ConflictException('This coupon has reached its usage limit');
      }
    }
    if (coupon.perCustomerUsageLimit !== null) {
      const customerUsage = await tx.couponRedemption.count({
        where: { couponId: coupon.id, userId: params.userId, status: { in: ['RESERVED', 'CONSUMED'] } },
      });
      if (customerUsage >= coupon.perCustomerUsageLimit) {
        throw new ConflictException('You have already used this coupon the maximum number of times allowed');
      }
    }

    return {
      couponId: coupon.id,
      promotionId: coupon.promotionId,
      couponCodeSnapshot: coupon.code,
      promotionNameSnapshot: coupon.promotion.name,
      eligibleAmount: calculation.eligibleAmount,
      discountAmount: calculation.discountAmount,
    };
  }

  /**
   * Phase 2 - called AFTER the Order has been created (within the SAME
   * transaction and advisory lock as evaluate() above), creating the actual
   * RESERVED row. `orderId` is UNIQUE on CouponRedemption, so a duplicate
   * create (e.g. an unexpected re-entry for the same order) fails safely
   * rather than double-redeeming (§34).
   */
  async createRedemptionRecord(
    tx: Prisma.TransactionClient,
    params: { storeId: string; userId: string; orderId: string; couponId: string; promotionId: string; discountAmount: Prisma.Decimal },
  ): Promise<void> {
    try {
      await tx.couponRedemption.create({
        data: {
          storeId: params.storeId,
          couponId: params.couponId,
          promotionId: params.promotionId,
          userId: params.userId,
          orderId: params.orderId,
          status: 'RESERVED',
          discountAmount: params.discountAmount,
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('A coupon redemption already exists for this order');
      }
      throw error;
    }
  }

  /**
   * RESERVED -> CONSUMED, exactly once (§36) - the atomic conditional
   * update means a client-verify/webhook race calling this twice for the
   * same order only ever applies it once; the loser sees count===0 and is a
   * safe no-op. A no-op for an order with no coupon at all.
   */
  async consume(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const result = await tx.couponRedemption.updateMany({ where: { orderId, status: 'RESERVED' }, data: { status: 'CONSUMED', consumedAt: new Date() } });
    if (result.count === 0) return;

    const redemption = await tx.couponRedemption.findUnique({ where: { orderId } });
    if (redemption) {
      await this.auditLogService.record({
        storeId: redemption.storeId,
        userId: redemption.userId,
        action: 'CouponRedeemed',
        entityType: 'CouponRedemption',
        entityId: redemption.id,
        metadata: { couponId: redemption.couponId, promotionId: redemption.promotionId, orderId },
      });
    }
  }

  /**
   * RESERVED -> RELEASED (§30/§37/§38/§80) - NEVER touches a CONSUMED row
   * (the atomic `status: 'RESERVED'` guard is what enforces this), so this
   * is safe to call unconditionally on every order cancellation regardless
   * of the order's previous status: it correctly releases a still-RESERVED
   * redemption (a PENDING_PAYMENT order that never completed payment) and
   * is a harmless no-op for a CONFIRMED-or-later order (whose redemption,
   * if any, is already CONSUMED by then - see PaymentService.consume()'s
   * own call site) - exactly the split policy §38 requires, with no
   * conditional branching needed at any call site.
   */
  async release(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    await tx.couponRedemption.updateMany({ where: { orderId, status: 'RESERVED' }, data: { status: 'RELEASED', releasedAt: new Date() } });
  }

  toTargeting(promotion: {
    products: { productId: string; isExcluded: boolean }[];
    categories: { categoryId: string; isExcluded: boolean }[];
    brands: { brandId: string; isExcluded: boolean }[];
  }): PromotionTargeting {
    return {
      includedProductIds: new Set(promotion.products.filter((p) => !p.isExcluded).map((p) => p.productId)),
      excludedProductIds: new Set(promotion.products.filter((p) => p.isExcluded).map((p) => p.productId)),
      includedCategoryIds: new Set(promotion.categories.filter((c) => !c.isExcluded).map((c) => c.categoryId)),
      excludedCategoryIds: new Set(promotion.categories.filter((c) => c.isExcluded).map((c) => c.categoryId)),
      includedBrandIds: new Set(promotion.brands.filter((b) => !b.isExcluded).map((b) => b.brandId)),
      excludedBrandIds: new Set(promotion.brands.filter((b) => b.isExcluded).map((b) => b.brandId)),
    };
  }

  /** §27 - server time only, UTC-consistent (JS Date comparisons are always instant-based, never dependent on any timezone string). */
  private assertDateWindow(coupon: { startsAt: Date | null; endsAt: Date | null }): void {
    const now = new Date();
    if (coupon.startsAt && now < coupon.startsAt) {
      throw new ConflictException('This coupon is not yet active');
    }
    if (coupon.endsAt && now >= coupon.endsAt) {
      throw new ConflictException('This coupon has expired');
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === PRISMA_UNIQUE_CONSTRAINT_ERROR;
  }
}
