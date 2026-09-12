import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { paginate } from '../../common/utils/pagination.util';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';
import { QueryPromotionDto } from './dto/query-promotion.dto';
import { UpdatePromotionStatusDto } from './dto/update-promotion-status.dto';

const PROMOTION_DETAIL_INCLUDE = {
  products: { select: { productId: true, isExcluded: true } },
  categories: { select: { categoryId: true, isExcluded: true } },
  brands: { select: { brandId: true, isExcluded: true } },
} satisfies Prisma.PromotionInclude;

type PromotionDetailRow = Prisma.PromotionGetPayload<{ include: typeof PROMOTION_DETAIL_INCLUDE }>;

interface TargetingInput {
  productIds?: string[];
  excludedProductIds?: string[];
  categoryIds?: string[];
  excludedCategoryIds?: string[];
  brandIds?: string[];
  excludedBrandIds?: string[];
}

/**
 * Phase 7 admin CRUD for the Promotion (discount config + targeting) - the
 * Coupon (code/dates/usage limits) is a separate model, see CouponsService.
 * Mirrors WarehousesService/ShippingMethodsService's CRUD/status/soft-delete
 * shape.
 */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(storeId: string, dto: CreatePromotionDto, actor: AuthenticatedUser) {
    this.validateDiscountConfig(dto.discountType, dto.value, dto.maximumDiscountAmount, dto.minimumOrderAmount);
    this.validateTargeting(dto);

    const promotion = await this.prisma.$transaction(async (tx) => {
      const created = await tx.promotion.create({
        data: {
          storeId,
          name: dto.name,
          description: dto.description,
          discountType: dto.discountType,
          value: dto.value,
          maximumDiscountAmount: dto.maximumDiscountAmount,
          minimumOrderAmount: dto.minimumOrderAmount,
          isActive: dto.isActive ?? true,
          sortOrder: dto.sortOrder ?? 0,
        },
      });

      await this.writeTargeting(tx, storeId, created.id, dto);

      return created;
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'PromotionCreated',
      entityType: 'Promotion',
      entityId: promotion.id,
      metadata: { after: this.toSafeConfig(promotion) },
    });

    return this.findOne(storeId, promotion.id);
  }

  async findAll(storeId: string, query: QueryPromotionDto) {
    const where: Prisma.PromotionWhereInput = {
      storeId,
      deletedAt: null,
      ...(query.status ? { isActive: query.status === 'active' } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.promotion.findMany({
        where,
        orderBy: { [query.sortBy ?? 'sortOrder']: query.sortOrder ?? 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.promotion.count({ where }),
    ]);

    return paginate(items.map((item) => this.toSafeConfig(item)), total, query.page, query.pageSize);
  }

  async findOne(storeId: string, id: string) {
    return this.toDetail(await this.getStoreScopedOrThrow(storeId, id));
  }

  async update(storeId: string, id: string, dto: UpdatePromotionDto, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedOrThrow(storeId, id);

    const nextDiscountType = dto.discountType ?? existing.discountType;
    const nextValue = dto.value ?? existing.value.toFixed(2);
    const nextMax = dto.maximumDiscountAmount ?? (existing.maximumDiscountAmount ? existing.maximumDiscountAmount.toFixed(2) : undefined);
    const nextMin = dto.minimumOrderAmount ?? (existing.minimumOrderAmount ? existing.minimumOrderAmount.toFixed(2) : undefined);
    this.validateDiscountConfig(nextDiscountType, nextValue, nextMax, nextMin);
    this.validateTargeting(dto);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.promotion.update({
        where: { id: existing.id },
        data: {
          name: dto.name ?? existing.name,
          description: dto.description !== undefined ? dto.description : existing.description,
          discountType: nextDiscountType,
          value: nextValue,
          maximumDiscountAmount: nextMax ?? null,
          minimumOrderAmount: nextMin ?? null,
          sortOrder: dto.sortOrder ?? existing.sortOrder,
        },
      });

      await this.writeTargeting(tx, storeId, existing.id, dto);

      return result;
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'PromotionUpdated',
      entityType: 'Promotion',
      entityId: updated.id,
      metadata: { before: this.toSafeConfig(existing), after: this.toSafeConfig(updated) },
    });

    return this.findOne(storeId, id);
  }

  async updateStatus(storeId: string, id: string, dto: UpdatePromotionStatusDto, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedOrThrow(storeId, id);

    const updated = await this.prisma.promotion.update({ where: { id: existing.id }, data: { isActive: dto.isActive } });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: dto.isActive ? 'PromotionActivated' : 'PromotionDeactivated',
      entityType: 'Promotion',
      entityId: updated.id,
      metadata: { before: { isActive: existing.isActive }, after: { isActive: updated.isActive } },
    });

    return this.toSafeConfig(updated);
  }

  async remove(storeId: string, id: string, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedOrThrow(storeId, id);

    const deleted = await this.prisma.promotion.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'PromotionDeleted',
      entityType: 'Promotion',
      entityId: deleted.id,
      metadata: { before: this.toSafeConfig(existing) },
    });

    return { id: deleted.id };
  }

  async getStoreScopedOrThrow(storeId: string, id: string): Promise<PromotionDetailRow> {
    const promotion = await this.prisma.promotion.findFirst({ where: { id, storeId, deletedAt: null }, include: PROMOTION_DETAIL_INCLUDE });
    if (!promotion) {
      throw new NotFoundException('Promotion not found');
    }
    return promotion;
  }

  /** Resolves the targeting sets DiscountEngineService needs, straight from the already-loaded rows - no extra query. */
  toTargeting(promotion: PromotionDetailRow) {
    return {
      includedProductIds: new Set(promotion.products.filter((p) => !p.isExcluded).map((p) => p.productId)),
      excludedProductIds: new Set(promotion.products.filter((p) => p.isExcluded).map((p) => p.productId)),
      includedCategoryIds: new Set(promotion.categories.filter((c) => !c.isExcluded).map((c) => c.categoryId)),
      excludedCategoryIds: new Set(promotion.categories.filter((c) => c.isExcluded).map((c) => c.categoryId)),
      includedBrandIds: new Set(promotion.brands.filter((b) => !b.isExcluded).map((b) => b.brandId)),
      excludedBrandIds: new Set(promotion.brands.filter((b) => b.isExcluded).map((b) => b.brandId)),
    };
  }

  private async writeTargeting(tx: Prisma.TransactionClient, storeId: string, promotionId: string, dto: TargetingInput): Promise<void> {
    if (dto.productIds !== undefined || dto.excludedProductIds !== undefined) {
      await tx.promotionProduct.deleteMany({ where: { promotionId } });
      const rows = [
        ...(dto.productIds ?? []).map((productId) => ({ storeId, promotionId, productId, isExcluded: false })),
        ...(dto.excludedProductIds ?? []).map((productId) => ({ storeId, promotionId, productId, isExcluded: true })),
      ];
      if (rows.length > 0) await tx.promotionProduct.createMany({ data: rows });
    }
    if (dto.categoryIds !== undefined || dto.excludedCategoryIds !== undefined) {
      await tx.promotionCategory.deleteMany({ where: { promotionId } });
      const rows = [
        ...(dto.categoryIds ?? []).map((categoryId) => ({ storeId, promotionId, categoryId, isExcluded: false })),
        ...(dto.excludedCategoryIds ?? []).map((categoryId) => ({ storeId, promotionId, categoryId, isExcluded: true })),
      ];
      if (rows.length > 0) await tx.promotionCategory.createMany({ data: rows });
    }
    if (dto.brandIds !== undefined || dto.excludedBrandIds !== undefined) {
      await tx.promotionBrand.deleteMany({ where: { promotionId } });
      const rows = [
        ...(dto.brandIds ?? []).map((brandId) => ({ storeId, promotionId, brandId, isExcluded: false })),
        ...(dto.excludedBrandIds ?? []).map((brandId) => ({ storeId, promotionId, brandId, isExcluded: true })),
      ];
      if (rows.length > 0) await tx.promotionBrand.createMany({ data: rows });
    }
  }

  private validateTargeting(dto: TargetingInput): void {
    const overlap = (included?: string[], excluded?: string[]) => {
      if (!included || !excluded) return false;
      const excludedSet = new Set(excluded);
      return included.some((id) => excludedSet.has(id));
    };
    if (overlap(dto.productIds, dto.excludedProductIds)) {
      throw new BadRequestException('A product cannot be both targeted and excluded by the same promotion');
    }
    if (overlap(dto.categoryIds, dto.excludedCategoryIds)) {
      throw new BadRequestException('A category cannot be both targeted and excluded by the same promotion');
    }
    if (overlap(dto.brandIds, dto.excludedBrandIds)) {
      throw new BadRequestException('A brand cannot be both targeted and excluded by the same promotion');
    }
  }

  /** §55 - the valid range for `value` depends on discountType, which no single DTO decorator can express; enforced here instead. */
  private validateDiscountConfig(discountType: string, value: string, maximumDiscountAmount?: string, minimumOrderAmount?: string): void {
    const numericValue = Number(value);
    if (discountType === 'PERCENTAGE') {
      if (!(numericValue > 0 && numericValue <= 100)) {
        throw new BadRequestException('A PERCENTAGE discount value must be greater than 0 and at most 100');
      }
    } else if (!(numericValue > 0)) {
      throw new BadRequestException('A FIXED_AMOUNT discount value must be greater than 0');
    }
    if (maximumDiscountAmount !== undefined && Number(maximumDiscountAmount) < 0) {
      throw new BadRequestException('maximumDiscountAmount must be non-negative');
    }
    if (minimumOrderAmount !== undefined && Number(minimumOrderAmount) < 0) {
      throw new BadRequestException('minimumOrderAmount must be non-negative');
    }
  }

  private toDetail(promotion: PromotionDetailRow) {
    return {
      ...this.toSafeConfig(promotion),
      productIds: promotion.products.filter((p) => !p.isExcluded).map((p) => p.productId),
      excludedProductIds: promotion.products.filter((p) => p.isExcluded).map((p) => p.productId),
      categoryIds: promotion.categories.filter((c) => !c.isExcluded).map((c) => c.categoryId),
      excludedCategoryIds: promotion.categories.filter((c) => c.isExcluded).map((c) => c.categoryId),
      brandIds: promotion.brands.filter((b) => !b.isExcluded).map((b) => b.brandId),
      excludedBrandIds: promotion.brands.filter((b) => b.isExcluded).map((b) => b.brandId),
    };
  }

  private toSafeConfig(promotion: {
    id: string;
    name: string;
    description: string | null;
    discountType: string;
    value: Prisma.Decimal;
    maximumDiscountAmount: Prisma.Decimal | null;
    minimumOrderAmount: Prisma.Decimal | null;
    isActive: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: promotion.id,
      name: promotion.name,
      description: promotion.description,
      discountType: promotion.discountType,
      value: promotion.value.toFixed(2),
      maximumDiscountAmount: promotion.maximumDiscountAmount ? promotion.maximumDiscountAmount.toFixed(2) : null,
      minimumOrderAmount: promotion.minimumOrderAmount ? promotion.minimumOrderAmount.toFixed(2) : null,
      isActive: promotion.isActive,
      sortOrder: promotion.sortOrder,
      createdAt: promotion.createdAt,
      updatedAt: promotion.updatedAt,
    };
  }
}
