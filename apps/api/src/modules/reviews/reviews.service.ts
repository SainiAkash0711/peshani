import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { OutboxService } from '../notifications/outbox.service';
import { paginate } from '../../common/utils/pagination.util';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ModerateReviewDto } from './dto/moderate-review.dto';
import { ReportReviewDto } from './dto/report-review.dto';
import { QueryReviewsDto } from './dto/query-reviews.dto';
import { QueryAdminReviewsDto } from './dto/query-admin-reviews.dto';

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

/**
 * Phase 8 - Product Reviews & Ratings.
 *
 * Design decision (documented per the Phase 8 prompt's own instruction to
 * document any deviation from its literal field list): `orderItemId` is
 * REQUIRED, not optional, on every review - this system has no path to an
 * "unverified" review. That is a deliberate simplification: it reuses the
 * existing Order/OrderItem lifecycle as the sole eligibility mechanism
 * (§14 "if an existing schema capability can be reused, reuse it"), keeps
 * the "one review per OrderItem" rule (§5) enforceable as a single database
 * unique constraint with no additional application bookkeeping, and means
 * verifiedPurchase is always true for any review that exists - matching the
 * "Amazon-style verified-purchase-only" review model. The verifiedPurchase
 * column is still stored and returned (never a derived/computed value at
 * read time) so the field exists exactly as the schema in the prompt
 * requested, and so a future phase could add a non-purchase-gated review
 * path without another migration.
 *
 * Verified-purchase eligibility (§6): the referenced Order must belong to
 * the authenticated customer AND the current store, the OrderItem must
 * belong to that Order and reference the given product (and variant, where
 * applicable), and the Order must have reached DELIVERED - this store's
 * existing Phase 6 fulfillment lifecycle's strictest "customer actually
 * received the product" state, chosen deliberately over the earlier
 * CONFIRMED/PROCESSING/PACKED/SHIPPED states so "verified purchase" means
 * what it says.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly outboxService: OutboxService,
  ) {}

  async create(storeId: string, actor: AuthenticatedUser, dto: CreateReviewDto) {
    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, storeId, deletedAt: null } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    if (dto.variantId) {
      const variant = await this.prisma.productVariant.findFirst({ where: { id: dto.variantId, productId: dto.productId, deletedAt: null } });
      if (!variant) {
        throw new NotFoundException('Variant not found for this product');
      }
    }

    const orderItem = await this.prisma.orderItem.findFirst({
      where: { id: dto.orderItemId },
      include: { order: true },
    });
    if (!orderItem || orderItem.order.storeId !== storeId || orderItem.order.userId !== actor.userId) {
      // Never reveals whether the orderItemId exists at all, or belongs to
      // someone else, or another store - same safe-404 convention used
      // throughout this codebase (§26 "customer cannot create review for
      // another customer's order").
      throw new NotFoundException('Order item not found');
    }
    if (orderItem.productId !== dto.productId || (dto.variantId ? orderItem.variantId !== dto.variantId : !!orderItem.variantId)) {
      throw new BadRequestException('This order item does not match the specified product/variant');
    }
    if (orderItem.order.status !== 'DELIVERED') {
      throw new ConflictException('You can only review a product after your order has been delivered');
    }

    try {
      const review = await this.prisma.productReview.create({
        data: {
          storeId,
          productId: dto.productId,
          variantId: dto.variantId,
          userId: actor.userId,
          orderId: orderItem.orderId,
          orderItemId: dto.orderItemId,
          rating: dto.rating,
          title: dto.title,
          body: dto.body,
          status: 'PENDING',
          verifiedPurchase: true,
        },
      });

      await this.auditLogService.record({
        storeId,
        userId: actor.userId,
        action: 'REVIEW_CREATED',
        entityType: 'ProductReview',
        entityId: review.id,
        metadata: { productId: dto.productId, orderItemId: dto.orderItemId, rating: dto.rating },
      });

      return this.toCustomerDetail(review);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        // orderItemId is UNIQUE (§5) - a duplicate concurrent create for the
        // SAME order item hits this constraint rather than racing a
        // read-then-write check.
        throw new ConflictException('You have already reviewed this item');
      }
      throw error;
    }
  }

  async update(storeId: string, actor: AuthenticatedUser, reviewId: string, dto: UpdateReviewDto) {
    const existing = await this.getOwnedOrThrow(storeId, actor.userId, reviewId);

    const updated = await this.prisma.productReview.update({
      where: { id: existing.id },
      data: {
        rating: dto.rating ?? existing.rating,
        title: dto.title !== undefined ? dto.title : existing.title,
        body: dto.body ?? existing.body,
        // Any customer edit resets moderation to PENDING (§8 - explicit
        // policy) - an earlier APPROVED/REJECTED/HIDDEN decision was made
        // about the OLD content, never the edited content, so it must be
        // re-moderated rather than silently keeping stale approval visible
        // to the public (or stale rejection hiding genuinely fixed content).
        status: 'PENDING',
        moderatedByUserId: null,
        moderatedAt: null,
        moderationNote: null,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'REVIEW_UPDATED',
      entityType: 'ProductReview',
      entityId: updated.id,
      metadata: {},
    });

    return this.toCustomerDetail(updated);
  }

  async remove(storeId: string, actor: AuthenticatedUser, reviewId: string) {
    const existing = await this.getOwnedOrThrow(storeId, actor.userId, reviewId);

    await this.prisma.productReview.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'REVIEW_DELETED',
      entityType: 'ProductReview',
      entityId: existing.id,
      metadata: { source: 'CUSTOMER' },
    });

    return { id: existing.id };
  }

  async addHelpfulVote(storeId: string, actor: AuthenticatedUser, reviewId: string) {
    const review = await this.getStoreScopedApprovedOrThrow(storeId, reviewId);
    try {
      await this.prisma.reviewHelpfulVote.create({ data: { storeId, reviewId: review.id, userId: actor.userId } });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) throw error;
      // Already voted (§12) - idempotent, not an error - a repeated click
      // of "helpful" is a no-op, never a duplicate row.
    }
    const count = await this.prisma.reviewHelpfulVote.count({ where: { reviewId: review.id } });
    return { reviewId: review.id, helpfulCount: count, votedByCurrentUser: true };
  }

  async removeHelpfulVote(storeId: string, actor: AuthenticatedUser, reviewId: string) {
    const review = await this.getStoreScopedApprovedOrThrow(storeId, reviewId);
    await this.prisma.reviewHelpfulVote.deleteMany({ where: { reviewId: review.id, userId: actor.userId } });
    const count = await this.prisma.reviewHelpfulVote.count({ where: { reviewId: review.id } });
    return { reviewId: review.id, helpfulCount: count, votedByCurrentUser: false };
  }

  async report(storeId: string, actor: AuthenticatedUser, reviewId: string, dto: ReportReviewDto) {
    // A review can be reported regardless of its current status (even a
    // HIDDEN one) - the store's own scoping is what matters here, not
    // public visibility.
    const review = await this.prisma.productReview.findFirst({ where: { id: reviewId, storeId, deletedAt: null } });
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    try {
      await this.prisma.reviewReport.create({ data: { storeId, reviewId: review.id, userId: actor.userId, reason: dto.reason } });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) throw error;
      // One report per customer per review, permanently (§13 design
      // decision - simpler than tracking "is there still an OPEN report",
      // and still fully prevents repeat-spam of the same reviewer/review pair).
      throw new ConflictException('You have already reported this review');
    }

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'REVIEW_REPORTED',
      entityType: 'ProductReview',
      entityId: review.id,
      metadata: {},
    });

    return { reviewId: review.id, reported: true };
  }

  // -----------------------------------------------------------------------
  // Public storefront (§10/§11)
  // -----------------------------------------------------------------------

  async findPublicForProduct(storeId: string, productId: string, query: QueryReviewsDto) {
    const where: Prisma.ProductReviewWhereInput = {
      storeId,
      productId,
      status: 'APPROVED',
      deletedAt: null,
      ...(query.rating ? { rating: query.rating } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.productReview.findMany({
        where,
        include: { user: { select: { firstName: true, lastName: true } }, _count: { select: { helpfulVotes: true } } },
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.productReview.count({ where }),
    ]);

    return paginate(items.map((r) => this.toPublicSummary(r)), total, query.page, query.pageSize);
  }

  /** Efficient, single grouped aggregation (§11) - never one query per star, never loaded into memory row-by-row. */
  async getRatingSummary(storeId: string, productId: string) {
    const grouped = await this.prisma.productReview.groupBy({
      by: ['rating'],
      where: { storeId, productId, status: 'APPROVED', deletedAt: null },
      _count: { _all: true },
    });

    const countByStar = new Map(grouped.map((g) => [g.rating, g._count._all]));
    const total = grouped.reduce((sum, g) => sum + g._count._all, 0);
    const weightedSum = grouped.reduce((sum, g) => sum + g.rating * g._count._all, 0);

    return {
      productId,
      totalReviews: total,
      averageRating: total > 0 ? Number((weightedSum / total).toFixed(2)) : 0,
      distribution: {
        5: countByStar.get(5) ?? 0,
        4: countByStar.get(4) ?? 0,
        3: countByStar.get(3) ?? 0,
        2: countByStar.get(2) ?? 0,
        1: countByStar.get(1) ?? 0,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Admin moderation (§14)
  // -----------------------------------------------------------------------

  async findAllForAdmin(storeId: string, query: QueryAdminReviewsDto) {
    const where: Prisma.ProductReviewWhereInput = {
      storeId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.rating ? { rating: query.rating } : {}),
      ...(query.verifiedPurchase !== undefined ? { verifiedPurchase: query.verifiedPurchase } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.productReview.findMany({
        where,
        include: { product: { select: { name: true, slug: true } }, user: { select: { email: true, firstName: true, lastName: true } } },
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.productReview.count({ where }),
    ]);

    return paginate(items.map((r) => this.toAdminSummary(r)), total, query.page, query.pageSize);
  }

  async findOneForAdmin(storeId: string, reviewId: string) {
    const review = await this.prisma.productReview.findFirst({
      where: { id: reviewId, storeId, deletedAt: null },
      include: { product: { select: { name: true, slug: true } }, user: { select: { email: true, firstName: true, lastName: true } } },
    });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    return this.toAdminSummary(review);
  }

  async moderate(storeId: string, actor: AuthenticatedUser, reviewId: string, dto: ModerateReviewDto) {
    const existing = await this.prisma.productReview.findFirst({ where: { id: reviewId, storeId, deletedAt: null }, include: { product: { select: { name: true } } } });
    if (!existing) {
      throw new NotFoundException('Review not found');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.productReview.update({
        where: { id: existing.id },
        data: { status: dto.status, moderatedByUserId: actor.userId, moderatedAt: new Date(), moderationNote: dto.moderationNote },
      });

      // Phase 9 §15 - only APPROVED/REJECTED notify the customer; HIDDEN is
      // a moderation action against an already-visible review, not a
      // decision the author is waiting to hear about (§15: "do not expose
      // moderation information to unauthorized users" - HIDDEN's reason is
      // often abuse/policy-related and not owed to the reviewer as a
      // notification).
      if (dto.status === 'APPROVED' || dto.status === 'REJECTED') {
        const eventType = dto.status === 'APPROVED' ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED';
        await this.outboxService.record(tx, {
          storeId,
          eventType,
          aggregateType: 'ProductReview',
          aggregateId: existing.id,
          idempotencyKey: `${eventType}:${existing.id}`,
          payload: { userId: existing.userId, reviewId: existing.id, productName: existing.product?.name ?? 'your product' },
        });
      }

      return result;
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: `REVIEW_${dto.status}`,
      entityType: 'ProductReview',
      entityId: updated.id,
      metadata: { previousStatus: existing.status, moderationNote: dto.moderationNote },
    });

    return this.toAdminSummary(updated);
  }

  async removeAsAdmin(storeId: string, actor: AuthenticatedUser, reviewId: string) {
    const existing = await this.prisma.productReview.findFirst({ where: { id: reviewId, storeId, deletedAt: null } });
    if (!existing) {
      throw new NotFoundException('Review not found');
    }

    await this.prisma.productReview.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'REVIEW_DELETED',
      entityType: 'ProductReview',
      entityId: existing.id,
      metadata: { source: 'ADMIN' },
    });

    return { id: existing.id };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async getOwnedOrThrow(storeId: string, userId: string, reviewId: string) {
    const review = await this.prisma.productReview.findFirst({ where: { id: reviewId, storeId, userId, deletedAt: null } });
    if (!review) {
      // Never distinguishes "doesn't exist" from "belongs to someone else"
      // (§26).
      throw new NotFoundException('Review not found');
    }
    return review;
  }

  private async getStoreScopedApprovedOrThrow(storeId: string, reviewId: string) {
    const review = await this.prisma.productReview.findFirst({ where: { id: reviewId, storeId, status: 'APPROVED', deletedAt: null } });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    return review;
  }

  private toCustomerDetail(review: {
    id: string;
    productId: string | null;
    variantId: string | null;
    rating: number;
    title: string | null;
    body: string;
    status: string;
    verifiedPurchase: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: review.id,
      productId: review.productId,
      variantId: review.variantId,
      rating: review.rating,
      title: review.title,
      body: review.body,
      status: review.status,
      verifiedPurchase: review.verifiedPurchase,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  }

  private toPublicSummary(review: {
    id: string;
    rating: number;
    title: string | null;
    body: string;
    verifiedPurchase: boolean;
    createdAt: Date;
    user: { firstName: string | null; lastName: string | null };
    _count: { helpfulVotes: number };
  }) {
    const displayName = [review.user.firstName, review.user.lastName?.charAt(0)].filter(Boolean).join(' ') || 'Verified Customer';
    return {
      id: review.id,
      reviewerDisplayName: displayName,
      rating: review.rating,
      title: review.title,
      body: review.body,
      verifiedPurchase: review.verifiedPurchase,
      createdAt: review.createdAt,
      helpfulCount: review._count.helpfulVotes,
    };
  }

  private toAdminSummary(review: {
    id: string;
    productId: string | null;
    variantId: string | null;
    userId: string;
    orderId: string;
    orderItemId: string;
    rating: number;
    title: string | null;
    body: string;
    status: string;
    verifiedPurchase: boolean;
    moderatedByUserId: string | null;
    moderatedAt: Date | null;
    moderationNote: string | null;
    createdAt: Date;
    updatedAt: Date;
    product?: { name: string; slug: string } | null;
    user?: { email: string; firstName: string | null; lastName: string | null };
  }) {
    return {
      id: review.id,
      productId: review.productId,
      productName: review.product?.name ?? null,
      variantId: review.variantId,
      userId: review.userId,
      customerEmail: review.user?.email ?? null,
      customerName: review.user ? [review.user.firstName, review.user.lastName].filter(Boolean).join(' ') : null,
      orderId: review.orderId,
      orderItemId: review.orderItemId,
      rating: review.rating,
      title: review.title,
      body: review.body,
      status: review.status,
      verifiedPurchase: review.verifiedPurchase,
      moderatedByUserId: review.moderatedByUserId,
      moderatedAt: review.moderatedAt,
      moderationNote: review.moderationNote,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === PRISMA_UNIQUE_CONSTRAINT_ERROR;
  }
}
