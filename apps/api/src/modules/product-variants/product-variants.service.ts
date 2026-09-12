import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { paginate } from '../../common/utils/pagination.util';
import { slugify } from '../../common/utils/slug.util';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { VariantGeneratorService } from './variant-generator.service';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { UpdateVariantStatusDto } from './dto/update-variant-status.dto';
import { GenerateVariantsDto } from './dto/generate-variants.dto';
import { AxesInputDto } from './dto/variant-axis.dto';

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

interface HasMoneyFields {
  price: Prisma.Decimal;
  compareAtPrice: Prisma.Decimal | null;
  costPrice: Prisma.Decimal | null;
  weight: Prisma.Decimal | null;
}

@Injectable()
export class ProductVariantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly variantGenerator: VariantGeneratorService,
  ) {}

  async getStoreScopedProductOrThrow(storeId: string, productId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, storeId, deletedAt: null } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  async create(storeId: string, productId: string, dto: CreateVariantDto, actor: AuthenticatedUser) {
    await this.getStoreScopedProductOrThrow(storeId, productId);
    await this.validateAttributeValueIds(storeId, dto.attributeValueIds);

    const sku = this.normalizeSku(dto.sku);
    const combinationKey = this.variantGenerator.buildCombinationKey(dto.attributeValueIds);

    if (await this.combinationExists(productId, combinationKey)) {
      throw new ConflictException('A variant with this exact attribute combination already exists for this product');
    }
    if (await this.skuExists(storeId, sku)) {
      throw new ConflictException(`SKU "${sku}" is already in use in this store`);
    }
    if (dto.barcode && (await this.barcodeExists(storeId, dto.barcode))) {
      throw new ConflictException(`Barcode "${dto.barcode}" is already in use in this store`);
    }

    try {
      const variant = await this.prisma.$transaction(async (tx) => {
        const created = await tx.productVariant.create({
          data: {
            storeId,
            productId,
            sku,
            barcode: dto.barcode,
            price: dto.price,
            compareAtPrice: dto.compareAtPrice,
            costPrice: dto.costPrice,
            weight: dto.weight,
            status: dto.status,
            image: dto.image,
            combinationKey,
          },
        });
        await tx.productVariantAttributeValue.createMany({
          data: dto.attributeValueIds.map((attributeValueId) => ({ variantId: created.id, attributeValueId })),
        });
        return created;
      });

      await this.auditLogService.record({
        storeId,
        userId: actor.userId,
        action: 'VariantCreated',
        entityType: 'ProductVariant',
        entityId: variant.id,
        metadata: { after: variant, productId },
      });

      return this.formatMoneyFields(variant);
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  async findAll(storeId: string, productId: string, query: PaginationQueryDto) {
    await this.getStoreScopedProductOrThrow(storeId, productId);

    const where = { productId, deletedAt: null };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.productVariant.findMany({
        where,
        include: { attributeValues: { include: { attributeValue: { include: { attribute: true } } } } },
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.productVariant.count({ where }),
    ]);

    return paginate(items.map((v) => this.toResponse(v)), total, query.page, query.pageSize);
  }

  async findOne(storeId: string, productId: string, variantId: string) {
    await this.getStoreScopedProductOrThrow(storeId, productId);
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, deletedAt: null },
      include: { attributeValues: { include: { attributeValue: { include: { attribute: true } } } } },
    });
    if (!variant) {
      throw new NotFoundException('Variant not found');
    }
    return this.toResponse(variant);
  }

  async update(storeId: string, productId: string, variantId: string, dto: UpdateVariantDto, actor: AuthenticatedUser) {
    await this.getStoreScopedProductOrThrow(storeId, productId);
    const existing = await this.getScopedVariantOrThrow(productId, variantId);

    let sku = existing.sku;
    if (dto.sku) {
      sku = this.normalizeSku(dto.sku);
      if (sku !== existing.sku && (await this.skuExists(storeId, sku))) {
        throw new ConflictException(`SKU "${sku}" is already in use in this store`);
      }
    }

    if (dto.barcode !== undefined && dto.barcode !== existing.barcode) {
      if (dto.barcode && (await this.barcodeExists(storeId, dto.barcode, variantId))) {
        throw new ConflictException(`Barcode "${dto.barcode}" is already in use in this store`);
      }
    }

    let combinationKey = existing.combinationKey;
    let attributeValueIds: string[] | undefined;
    let combinationChanged = false;
    if (dto.attributeValueIds) {
      await this.validateAttributeValueIds(storeId, dto.attributeValueIds);
      combinationKey = this.variantGenerator.buildCombinationKey(dto.attributeValueIds);
      if (combinationKey !== existing.combinationKey) {
        if (await this.combinationExists(productId, combinationKey, variantId)) {
          throw new ConflictException('Another variant with this exact attribute combination already exists for this product');
        }
        attributeValueIds = dto.attributeValueIds;
        combinationChanged = true;
      }
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.productVariant.update({
          where: { id: existing.id },
          data: {
            sku,
            barcode: dto.barcode !== undefined ? dto.barcode : existing.barcode,
            price: dto.price ?? existing.price,
            compareAtPrice: dto.compareAtPrice !== undefined ? dto.compareAtPrice : existing.compareAtPrice,
            costPrice: dto.costPrice !== undefined ? dto.costPrice : existing.costPrice,
            weight: dto.weight !== undefined ? dto.weight : existing.weight,
            status: dto.status ?? existing.status,
            image: dto.image !== undefined ? dto.image : existing.image,
            combinationKey,
          },
        });

        if (attributeValueIds) {
          await tx.productVariantAttributeValue.deleteMany({ where: { variantId: existing.id } });
          await tx.productVariantAttributeValue.createMany({
            data: attributeValueIds.map((attributeValueId) => ({ variantId: existing.id, attributeValueId })),
          });
        }

        return result;
      });

      await this.auditLogService.record({
        storeId,
        userId: actor.userId,
        action: combinationChanged ? 'VariantCombinationChanged' : 'VariantUpdated',
        entityType: 'ProductVariant',
        entityId: updated.id,
        metadata: { before: existing, after: updated, productId },
      });

      return this.formatMoneyFields(updated);
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  async updateStatus(
    storeId: string,
    productId: string,
    variantId: string,
    dto: UpdateVariantStatusDto,
    actor: AuthenticatedUser,
  ) {
    await this.getStoreScopedProductOrThrow(storeId, productId);
    const existing = await this.getScopedVariantOrThrow(productId, variantId);

    const updated = await this.prisma.productVariant.update({
      where: { id: existing.id },
      data: { status: dto.status },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'VariantStatusChanged',
      entityType: 'ProductVariant',
      entityId: updated.id,
      metadata: { before: { status: existing.status }, after: { status: updated.status }, productId },
    });

    return this.formatMoneyFields(updated);
  }

  async remove(storeId: string, productId: string, variantId: string, actor: AuthenticatedUser) {
    await this.getStoreScopedProductOrThrow(storeId, productId);
    const existing = await this.getScopedVariantOrThrow(productId, variantId);

    const inventoryUsage = await this.prisma.inventoryItem.count({ where: { variantId } });
    if (inventoryUsage > 0) {
      throw new ConflictException(
        `Cannot delete this variant: it has ${inventoryUsage} inventory record(s). Deactivate it instead.`,
      );
    }

    const deleted = await this.prisma.productVariant.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), status: 'ARCHIVED' },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'VariantDeleted',
      entityType: 'ProductVariant',
      entityId: deleted.id,
      metadata: { before: existing, productId },
    });

    return { id: deleted.id };
  }

  async previewCombinations(storeId: string, productId: string, dto: AxesInputDto) {
    await this.getStoreScopedProductOrThrow(storeId, productId);
    const valuesByAxis = await this.validateAxes(storeId, dto.axes);

    const total = this.variantGenerator.countCombinations(dto.axes);
    const max = this.variantGenerator.getMaxCombinations();
    if (total > max) {
      return { total, maxAllowed: max, exceedsLimit: true, combinations: [] as unknown[] };
    }

    const combinations = this.variantGenerator.generate(dto.axes);
    return {
      total,
      maxAllowed: max,
      exceedsLimit: false,
      combinations: combinations.map((combo) => ({
        attributeValueIds: combo.attributeValueIds,
        values: combo.attributeValueIds.map((id) => {
          const info = valuesByAxis.get(id)!;
          return { attributeId: info.attributeId, attributeName: info.attributeName, valueId: id, valueLabel: info.value };
        }),
      })),
    };
  }

  async generate(storeId: string, productId: string, dto: GenerateVariantsDto, actor: AuthenticatedUser) {
    const product = await this.getStoreScopedProductOrThrow(storeId, productId);
    if (product.productType !== 'VARIABLE') {
      throw new BadRequestException('Set the product type to VARIABLE before generating variants');
    }

    const valuesByAxis = await this.validateAxes(storeId, dto.axes);
    const combinations = this.variantGenerator.generate(dto.axes);

    const existingVariants = await this.prisma.productVariant.findMany({
      where: { productId, deletedAt: null },
    });
    const existingByKey = new Map(existingVariants.map((v) => [v.combinationKey, v]));
    const existingSkus = new Set(existingVariants.map((v) => v.sku));

    const preserved = combinations
      .filter((combo) => existingByKey.has(combo.combinationKey))
      .map((combo) => existingByKey.get(combo.combinationKey)!);

    const toCreate = combinations.filter((combo) => !existingByKey.has(combo.combinationKey));

    const basePrice = dto.defaults?.price ?? product.basePrice.toString();
    const baseCost = dto.defaults?.costPrice ?? product.costPrice?.toString();
    const baseWeight = dto.defaults?.weight ?? product.weight?.toString();

    const plannedCreates = toCreate.map((combo) => {
      const labelSlugs = combo.attributeValueIds.map((id) => slugify(valuesByAxis.get(id)!.value));
      const skuBase = `${slugify(product.sku ?? product.slug)}-${labelSlugs.join('-')}`.toUpperCase();
      let sku = skuBase;
      let suffix = 2;
      while (existingSkus.has(sku)) {
        sku = `${skuBase}-${suffix}`;
        suffix += 1;
      }
      existingSkus.add(sku);
      return { combo, sku };
    });

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const results = [];
        for (const plan of plannedCreates) {
          const variant = await tx.productVariant.create({
            data: {
              storeId,
              productId,
              sku: plan.sku,
              price: basePrice,
              costPrice: baseCost,
              weight: baseWeight,
              combinationKey: plan.combo.combinationKey,
            },
          });
          await tx.productVariantAttributeValue.createMany({
            data: plan.combo.attributeValueIds.map((attributeValueId) => ({
              variantId: variant.id,
              attributeValueId,
            })),
          });
          results.push(variant);
        }
        return results;
      });

      await this.auditLogService.record({
        storeId,
        userId: actor.userId,
        action: 'VariantsGenerated',
        entityType: 'Product',
        entityId: productId,
        metadata: { createdCount: created.length, preservedCount: preserved.length, requestedTotal: combinations.length },
      });

      return {
        created: created.map((v) => this.formatMoneyFields(v)),
        preserved: preserved.map((v) => this.formatMoneyFields(v)),
        totalRequested: combinations.length,
      };
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  private formatMoneyFields<T extends HasMoneyFields>(variant: T) {
    return {
      ...variant,
      price: variant.price.toFixed(2),
      compareAtPrice: variant.compareAtPrice?.toFixed(2) ?? null,
      costPrice: variant.costPrice?.toFixed(2) ?? null,
      weight: variant.weight?.toFixed(3) ?? null,
    };
  }

  private toResponse(
    variant: Prisma.ProductVariantGetPayload<{
      include: { attributeValues: { include: { attributeValue: { include: { attribute: true } } } } };
    }>,
  ) {
    const { attributeValues, ...rest } = variant;
    return {
      ...this.formatMoneyFields(rest),
      attributeValues: attributeValues.map((av) => ({
        attributeId: av.attributeValue.attribute.id,
        attributeName: av.attributeValue.attribute.name,
        valueId: av.attributeValue.id,
        valueLabel: av.attributeValue.value,
      })),
    };
  }

  private async getScopedVariantOrThrow(productId: string, variantId: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, deletedAt: null },
    });
    if (!variant) {
      throw new NotFoundException('Variant not found');
    }
    return variant;
  }

  private normalizeSku(sku: string): string {
    return sku.trim().toUpperCase();
  }

  private async skuExists(storeId: string, sku: string, excludeId?: string): Promise<boolean> {
    const match = await this.prisma.productVariant.findFirst({
      where: { storeId, sku, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return !!match;
  }

  private async barcodeExists(storeId: string, barcode: string, excludeId?: string): Promise<boolean> {
    const match = await this.prisma.productVariant.findFirst({
      where: { storeId, barcode, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return !!match;
  }

  private async combinationExists(productId: string, combinationKey: string, excludeId?: string): Promise<boolean> {
    const match = await this.prisma.productVariant.findFirst({
      where: { productId, combinationKey, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return !!match;
  }

  /** Validates every value id: exists, belongs to this store (via its attribute), is active. */
  private async validateAttributeValueIds(storeId: string, valueIds: string[]) {
    const uniqueIds = Array.from(new Set(valueIds));
    const values = await this.prisma.attributeValue.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null },
      include: { attribute: true },
    });
    const found = new Map(values.map((v) => [v.id, v]));

    for (const id of uniqueIds) {
      const value = found.get(id);
      if (!value || value.attribute.storeId !== storeId || value.attribute.deletedAt) {
        throw new NotFoundException(`Attribute value ${id} not found`);
      }
      if (!value.isActive || !value.attribute.isActive) {
        throw new BadRequestException(`Attribute value "${value.value}" is inactive and cannot be used on a variant`);
      }
    }
    return found;
  }

  /** Same as validateAttributeValueIds, but also confirms each value is submitted under its own attribute's axis. */
  private async validateAxes(storeId: string, axes: { attributeId: string; valueIds: string[] }[]) {
    const allValueIds = axes.flatMap((axis) => axis.valueIds);
    const found = await this.validateAttributeValueIds(storeId, allValueIds);

    const result = new Map<string, { attributeId: string; attributeName: string; value: string }>();
    for (const axis of axes) {
      for (const valueId of axis.valueIds) {
        const value = found.get(valueId)!;
        if (value.attributeId !== axis.attributeId) {
          throw new BadRequestException(
            `Attribute value ${valueId} does not belong to attribute ${axis.attributeId}`,
          );
        }
        result.set(valueId, { attributeId: value.attributeId, attributeName: value.attribute.name, value: value.value });
      }
    }
    return result;
  }

  private translateWriteError(error: unknown): Error {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === PRISMA_UNIQUE_CONSTRAINT_ERROR
    ) {
      return new ConflictException('This SKU, barcode, or attribute combination is already in use (concurrent write detected)');
    }
    return error as Error;
  }
}
