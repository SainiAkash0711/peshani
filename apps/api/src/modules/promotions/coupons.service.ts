import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { paginate } from '../../common/utils/pagination.util';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { QueryCouponDto } from './dto/query-coupon.dto';
import { UpdateCouponStatusDto } from './dto/update-coupon-status.dto';

/** Case-insensitive lookup/uniqueness (§9) - trim + uppercase, consistently, everywhere a code is looked up, stored, or counted. */
export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Phase 7 admin CRUD for Coupon (code + dates + usage limits - the
 * authoritative location for those, see the Coupon model's own doc
 * comment). Discount configuration and targeting live on the associated
 * Promotion instead (PromotionsService).
 */
@Injectable()
export class CouponsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(storeId: string, dto: CreateCouponDto, actor: AuthenticatedUser) {
    const promotion = await this.prisma.promotion.findFirst({ where: { id: dto.promotionId, storeId, deletedAt: null } });
    if (!promotion) {
      throw new NotFoundException('Promotion not found');
    }

    const normalizedCode = normalizeCouponCode(dto.code);
    this.validateDates(dto.startsAt, dto.endsAt);

    if (await this.codeExists(storeId, normalizedCode)) {
      throw new ConflictException(`Coupon code "${dto.code}" is already in use in this store`);
    }

    const coupon = await this.prisma.coupon.create({
      data: {
        storeId,
        promotionId: dto.promotionId,
        code: dto.code,
        normalizedCode,
        isActive: dto.isActive ?? true,
        startsAt: dto.startsAt,
        endsAt: dto.endsAt,
        usageLimit: dto.usageLimit,
        perCustomerUsageLimit: dto.perCustomerUsageLimit,
      },
    });

    // The code itself is not a secret, but per §9 it is treated as
    // operational data worth keeping out of free-form audit metadata where
    // avoidable - the entityId (the coupon's own id) is enough to look the
    // row up directly if needed.
    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'CouponCreated',
      entityType: 'Coupon',
      entityId: coupon.id,
      metadata: { promotionId: dto.promotionId, isActive: coupon.isActive },
    });

    return this.toSafe(coupon);
  }

  async findAll(storeId: string, query: QueryCouponDto) {
    const where: Prisma.CouponWhereInput = {
      storeId,
      deletedAt: null,
      ...(query.status ? { isActive: query.status === 'active' } : {}),
      ...(query.promotionId ? { promotionId: query.promotionId } : {}),
      ...(query.search ? { normalizedCode: { contains: normalizeCouponCode(query.search) } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.coupon.findMany({
        where,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.coupon.count({ where }),
    ]);

    // Usage counts are derived live from CouponRedemption (§65) - never a
    // manually-incremented, driftable counter - counting RESERVED+CONSUMED
    // together (a reservation genuinely holds a usage slot).
    const usageByCouponId = await this.usageCounts(items.map((c) => c.id));

    return paginate(
      items.map((coupon) => ({ ...this.toSafe(coupon), usageCount: usageByCouponId.get(coupon.id) ?? 0 })),
      total,
      query.page,
      query.pageSize,
    );
  }

  async findOne(storeId: string, id: string) {
    const coupon = await this.getStoreScopedOrThrow(storeId, id);
    const usageByCouponId = await this.usageCounts([coupon.id]);
    return { ...this.toSafe(coupon), usageCount: usageByCouponId.get(coupon.id) ?? 0 };
  }

  async update(storeId: string, id: string, dto: UpdateCouponDto, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedOrThrow(storeId, id);

    // §44 - editing a coupon that already has redemptions must never corrupt
    // historical Order snapshots. It doesn't (Order/CouponRedemption freeze
    // their own discountAmount/code/promotion-name snapshot at redemption
    // time, never re-read from this row) - but the CODE itself is still
    // blocked from changing once redeemed, since silently repointing an
    // already-used code to mean something different going forward is
    // confusing operational practice even though it wouldn't corrupt data.
    const hasRedemptions = (await this.prisma.couponRedemption.count({ where: { couponId: id } })) > 0;
    if (dto.code && hasRedemptions) {
      throw new ConflictException('Cannot change the code of a coupon that has already been redeemed at least once');
    }

    this.validateDates(dto.startsAt ?? existing.startsAt?.toISOString(), dto.endsAt ?? existing.endsAt?.toISOString());

    let normalizedCode = existing.normalizedCode;
    if (dto.code) {
      normalizedCode = normalizeCouponCode(dto.code);
      if (normalizedCode !== existing.normalizedCode && (await this.codeExists(storeId, normalizedCode, id))) {
        throw new ConflictException(`Coupon code "${dto.code}" is already in use in this store`);
      }
    }

    const updated = await this.prisma.coupon.update({
      where: { id: existing.id },
      data: {
        code: dto.code ?? existing.code,
        normalizedCode,
        startsAt: dto.startsAt !== undefined ? dto.startsAt : existing.startsAt,
        endsAt: dto.endsAt !== undefined ? dto.endsAt : existing.endsAt,
        usageLimit: dto.usageLimit !== undefined ? dto.usageLimit : existing.usageLimit,
        perCustomerUsageLimit: dto.perCustomerUsageLimit !== undefined ? dto.perCustomerUsageLimit : existing.perCustomerUsageLimit,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'CouponUpdated',
      entityType: 'Coupon',
      entityId: updated.id,
      metadata: { promotionId: updated.promotionId },
    });

    return this.toSafe(updated);
  }

  async updateStatus(storeId: string, id: string, dto: UpdateCouponStatusDto, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedOrThrow(storeId, id);

    const updated = await this.prisma.coupon.update({ where: { id: existing.id }, data: { isActive: dto.isActive } });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: dto.isActive ? 'CouponActivated' : 'CouponDeactivated',
      entityType: 'Coupon',
      entityId: updated.id,
      metadata: { before: { isActive: existing.isActive }, after: { isActive: updated.isActive } },
    });

    return this.toSafe(updated);
  }

  async remove(storeId: string, id: string, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedOrThrow(storeId, id);

    const deleted = await this.prisma.coupon.update({ where: { id: existing.id }, data: { deletedAt: new Date(), isActive: false } });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'CouponDeleted',
      entityType: 'Coupon',
      entityId: deleted.id,
      metadata: { promotionId: existing.promotionId },
    });

    return { id: deleted.id };
  }

  async getStoreScopedOrThrow(storeId: string, id: string) {
    const coupon = await this.prisma.coupon.findFirst({ where: { id, storeId, deletedAt: null } });
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }
    return coupon;
  }

  /** Looked up by CouponRedemptionService/checkout - normalized, active, tenant-scoped, not soft-deleted. Does NOT itself check dates/usage limits (see CouponRedemptionService). */
  async findActiveByCodeOrThrow(storeId: string, code: string) {
    const coupon = await this.prisma.coupon.findFirst({
      where: { storeId, normalizedCode: normalizeCouponCode(code), isActive: true, deletedAt: null },
      include: { promotion: true },
    });
    if (!coupon || !coupon.promotion || coupon.promotion.deletedAt || !coupon.promotion.isActive) {
      throw new NotFoundException('Coupon not found or no longer valid');
    }
    return coupon;
  }

  private async usageCounts(couponIds: string[]): Promise<Map<string, number>> {
    if (couponIds.length === 0) return new Map();
    const grouped = await this.prisma.couponRedemption.groupBy({
      by: ['couponId'],
      where: { couponId: { in: couponIds }, status: { in: ['RESERVED', 'CONSUMED'] } },
      _count: { _all: true },
    });
    return new Map(grouped.map((g) => [g.couponId, g._count._all]));
  }

  private validateDates(startsAt?: string, endsAt?: string): void {
    if (startsAt && endsAt && new Date(startsAt).getTime() >= new Date(endsAt).getTime()) {
      throw new BadRequestException('startsAt must be before endsAt');
    }
  }

  private async codeExists(storeId: string, normalizedCode: string, excludeId?: string): Promise<boolean> {
    const match = await this.prisma.coupon.findFirst({
      where: { storeId, normalizedCode, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return !!match;
  }

  private toSafe(coupon: {
    id: string;
    promotionId: string;
    code: string;
    isActive: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
    usageLimit: number | null;
    perCustomerUsageLimit: number | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: coupon.id,
      promotionId: coupon.promotionId,
      code: coupon.code,
      isActive: coupon.isActive,
      startsAt: coupon.startsAt,
      endsAt: coupon.endsAt,
      usageLimit: coupon.usageLimit,
      perCustomerUsageLimit: coupon.perCustomerUsageLimit,
      createdAt: coupon.createdAt,
      updatedAt: coupon.updatedAt,
    };
  }
}
