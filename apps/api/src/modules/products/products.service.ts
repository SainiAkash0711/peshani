import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { generateUniqueSlug, slugify } from '../../common/utils/slug.util';
import { paginate } from '../../common/utils/pagination.util';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { UpdateProductStatusDto } from './dto/update-product-status.dto';

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

// DRAFT/ARCHIVED are dead ends coming back the other way on purpose: once a
// product is archived it must be duplicated or recreated, not silently
// resurrected; ACTIVE can't drop back to DRAFT for the same reason a
// published storefront listing shouldn't quietly vanish into "in progress".
const ALLOWED_STATUS_TRANSITIONS: Record<ProductStatus, ProductStatus[]> = {
  DRAFT: [ProductStatus.ACTIVE, ProductStatus.ARCHIVED],
  ACTIVE: [ProductStatus.INACTIVE, ProductStatus.ARCHIVED],
  INACTIVE: [ProductStatus.ACTIVE, ProductStatus.ARCHIVED],
  ARCHIVED: [],
  OUT_OF_STOCK: [ProductStatus.ACTIVE, ProductStatus.INACTIVE, ProductStatus.ARCHIVED],
};

const PRODUCT_LIST_INCLUDE = {
  brand: { select: { id: true, name: true } },
  categories: { include: { category: { select: { id: true, name: true } } } },
  _count: { select: { variants: { where: { deletedAt: null } } } },
} satisfies Prisma.ProductInclude;

const PRODUCT_DETAIL_INCLUDE = {
  ...PRODUCT_LIST_INCLUDE,
  tags: { include: { tag: { select: { id: true, name: true } } } },
  attributes: { include: { attribute: { select: { id: true, name: true, type: true } } } },
} satisfies Prisma.ProductInclude;

type ProductListRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_LIST_INCLUDE }>;
type ProductDetailRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_DETAIL_INCLUDE }>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(storeId: string, dto: CreateProductDto, actor: AuthenticatedUser) {
    const productType = dto.productType ?? 'SIMPLE';
    const sku = await this.resolveSkuForCreate(storeId, productType, dto.sku);
    const slug = await this.resolveSlug(storeId, dto.slug, dto.name);

    if (dto.brandId) await this.validateBrand(storeId, dto.brandId);
    if (dto.categoryIds?.length) await this.validateCategoryIds(storeId, dto.categoryIds);
    if (dto.attributeIds?.length) await this.validateAttributeIds(storeId, dto.attributeIds);

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
          data: {
            storeId,
            name: dto.name,
            slug,
            productType,
            sku,
            description: dto.description,
            shortDescription: dto.shortDescription,
            basePrice: dto.basePrice,
            compareAtPrice: dto.compareAtPrice,
            costPrice: dto.costPrice,
            taxClass: dto.taxClass,
            weight: dto.weight,
            seoTitle: dto.seoTitle,
            seoDescription: dto.seoDescription,
            isFeatured: dto.isFeatured ?? false,
            isBestseller: dto.isBestseller ?? false,
            isNewArrival: dto.isNewArrival ?? false,
            status: dto.status ?? 'DRAFT',
            brandId: dto.brandId,
          },
        });

        if (dto.categoryIds?.length) {
          await tx.productCategory.createMany({
            data: dto.categoryIds.map((categoryId) => ({ productId: created.id, categoryId })),
          });
        }
        if (dto.attributeIds?.length) {
          await tx.productAttribute.createMany({
            data: dto.attributeIds.map((attributeId) => ({ productId: created.id, attributeId })),
          });
        }
        if (dto.tagNames?.length) {
          await this.syncTags(tx, storeId, created.id, dto.tagNames);
        }

        return created;
      });

      await this.auditLogService.record({
        storeId,
        userId: actor.userId,
        action: 'ProductCreated',
        entityType: 'Product',
        entityId: product.id,
        metadata: { after: product },
      });

      return this.findOne(storeId, product.id);
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  async findAll(storeId: string, query: QueryProductDto) {
    const where: Prisma.ProductWhereInput = {
      storeId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { productType: query.type } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.categoryId ? { categories: { some: { categoryId: query.categoryId } } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
              { variants: { some: { barcode: { contains: query.search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: PRODUCT_LIST_INCLUDE,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);

    return paginate(items.map((p) => this.toListItem(p)), total, query.page, query.pageSize);
  }

  async findOne(storeId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, storeId, deletedAt: null },
      include: PRODUCT_DETAIL_INCLUDE,
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return this.toDetail(product);
  }

  async update(storeId: string, id: string, dto: UpdateProductDto, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedProductOrThrow(storeId, id);

    const sku = await this.resolveSkuForUpdate(storeId, existing, dto.sku, id);

    let slug = existing.slug;
    if (dto.slug) {
      slug = await this.resolveSlug(storeId, dto.slug, dto.name ?? existing.name, id);
    } else if (dto.name && dto.name !== existing.name) {
      slug = await generateUniqueSlug(dto.name, (candidate) => this.slugExists(storeId, candidate, id));
    }

    if (dto.brandId) await this.validateBrand(storeId, dto.brandId);
    if (dto.categoryIds?.length) await this.validateCategoryIds(storeId, dto.categoryIds);
    if (dto.attributeIds?.length) await this.validateAttributeIds(storeId, dto.attributeIds);

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.product.update({
          where: { id: existing.id },
          data: {
            name: dto.name ?? existing.name,
            slug,
            sku,
            description: dto.description !== undefined ? dto.description : existing.description,
            shortDescription: dto.shortDescription !== undefined ? dto.shortDescription : existing.shortDescription,
            basePrice: dto.basePrice ?? existing.basePrice,
            compareAtPrice: dto.compareAtPrice !== undefined ? dto.compareAtPrice : existing.compareAtPrice,
            costPrice: dto.costPrice !== undefined ? dto.costPrice : existing.costPrice,
            taxClass: dto.taxClass !== undefined ? dto.taxClass : existing.taxClass,
            weight: dto.weight !== undefined ? dto.weight : existing.weight,
            seoTitle: dto.seoTitle !== undefined ? dto.seoTitle : existing.seoTitle,
            seoDescription: dto.seoDescription !== undefined ? dto.seoDescription : existing.seoDescription,
            isFeatured: dto.isFeatured ?? existing.isFeatured,
            isBestseller: dto.isBestseller ?? existing.isBestseller,
            isNewArrival: dto.isNewArrival ?? existing.isNewArrival,
            brandId: dto.brandId !== undefined ? dto.brandId : existing.brandId,
          },
        });

        if (dto.categoryIds !== undefined) {
          await tx.productCategory.deleteMany({ where: { productId: existing.id } });
          if (dto.categoryIds.length) {
            await tx.productCategory.createMany({
              data: dto.categoryIds.map((categoryId) => ({ productId: existing.id, categoryId })),
            });
          }
        }
        if (dto.attributeIds !== undefined) {
          await tx.productAttribute.deleteMany({ where: { productId: existing.id } });
          if (dto.attributeIds.length) {
            await tx.productAttribute.createMany({
              data: dto.attributeIds.map((attributeId) => ({ productId: existing.id, attributeId })),
            });
          }
        }
        if (dto.tagNames !== undefined) {
          await tx.productTag.deleteMany({ where: { productId: existing.id } });
          if (dto.tagNames.length) {
            await this.syncTags(tx, storeId, existing.id, dto.tagNames);
          }
        }

        return result;
      });

      await this.recordUpdateAudit(storeId, existing, updated, dto, actor);

      return this.findOne(storeId, id);
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  async updateStatus(storeId: string, id: string, dto: UpdateProductStatusDto, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedProductOrThrow(storeId, id);

    if (existing.status !== dto.status && !ALLOWED_STATUS_TRANSITIONS[existing.status].includes(dto.status)) {
      throw new ConflictException(`Cannot transition a product from ${existing.status} to ${dto.status}`);
    }

    if (dto.status === 'ACTIVE') {
      await this.assertCanActivate(existing);
    }

    const updated = await this.prisma.product.update({
      where: { id: existing.id },
      data: {
        status: dto.status,
        publishedAt: dto.status === 'ACTIVE' && !existing.publishedAt ? new Date() : existing.publishedAt,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'ProductStatusChanged',
      entityType: 'Product',
      entityId: updated.id,
      metadata: { before: { status: existing.status }, after: { status: updated.status } },
    });

    return this.findOne(storeId, id);
  }

  async remove(storeId: string, id: string, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedProductOrThrow(storeId, id);

    const inventoryUsage = await this.prisma.inventoryItem.count({ where: { productId: id } });
    if (inventoryUsage > 0) {
      throw new ConflictException(
        `Cannot delete "${existing.name}": it has ${inventoryUsage} inventory record(s). Archive it instead.`,
      );
    }

    const deleted = await this.prisma.$transaction(async (tx) => {
      await tx.productVariant.updateMany({
        where: { productId: id, deletedAt: null },
        data: { deletedAt: new Date(), status: 'ARCHIVED' },
      });
      return tx.product.update({
        where: { id: existing.id },
        data: { deletedAt: new Date(), status: 'ARCHIVED' },
      });
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'ProductDeleted',
      entityType: 'Product',
      entityId: deleted.id,
      metadata: { before: existing },
    });

    return { id: deleted.id };
  }

  async duplicate(storeId: string, id: string, actor: AuthenticatedUser) {
    const existing = await this.prisma.product.findFirst({
      where: { id, storeId, deletedAt: null },
      include: { categories: true, tags: true, attributes: true },
    });
    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    const copyName = `${existing.name} (Copy)`;
    const slug = await generateUniqueSlug(copyName, (candidate) => this.slugExists(storeId, candidate));

    const duplicate = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          storeId,
          name: copyName,
          slug,
          productType: existing.productType,
          // SKU/barcode are never copied - they must be unique per store and
          // the admin should deliberately assign new ones (see Phase 2D spec).
          sku: null,
          description: existing.description,
          shortDescription: existing.shortDescription,
          basePrice: existing.basePrice,
          compareAtPrice: existing.compareAtPrice,
          costPrice: existing.costPrice,
          taxClass: existing.taxClass,
          weight: existing.weight,
          seoTitle: existing.seoTitle,
          seoDescription: existing.seoDescription,
          isFeatured: existing.isFeatured,
          isBestseller: existing.isBestseller,
          isNewArrival: existing.isNewArrival,
          brandId: existing.brandId,
          status: 'DRAFT',
        },
      });

      if (existing.categories.length) {
        await tx.productCategory.createMany({
          data: existing.categories.map((c) => ({ productId: created.id, categoryId: c.categoryId })),
        });
      }
      if (existing.tags.length) {
        await tx.productTag.createMany({
          data: existing.tags.map((t) => ({ productId: created.id, tagId: t.tagId })),
        });
      }
      if (existing.attributes.length) {
        await tx.productAttribute.createMany({
          data: existing.attributes.map((a) => ({ productId: created.id, attributeId: a.attributeId })),
        });
      }
      // Variants are intentionally not copied - see Phase 2D final report.

      return created;
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'ProductDuplicated',
      entityType: 'Product',
      entityId: duplicate.id,
      metadata: { sourceProductId: existing.id },
    });

    return this.findOne(storeId, duplicate.id);
  }

  async getStoreScopedProductOrThrow(storeId: string, id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, storeId, deletedAt: null } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  private async assertCanActivate(product: { productType: string; sku: string | null; id: string }) {
    if (product.productType === 'SIMPLE') {
      if (!product.sku) {
        throw new ConflictException('Cannot activate a simple product without a SKU');
      }
      return;
    }
    const variantCount = await this.prisma.productVariant.count({
      where: { productId: product.id, deletedAt: null },
    });
    if (variantCount === 0) {
      throw new ConflictException('Cannot activate a variable product with no variants. Generate at least one variant first.');
    }
  }

  private async recordUpdateAudit(
    storeId: string,
    before: { brandId: string | null },
    after: unknown,
    dto: UpdateProductDto,
    actor: AuthenticatedUser,
  ) {
    const productId = (after as { id: string }).id;
    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'ProductUpdated',
      entityType: 'Product',
      entityId: productId,
      metadata: { before, after },
    });
    if (dto.brandId !== undefined && dto.brandId !== before.brandId) {
      await this.auditLogService.record({
        storeId,
        userId: actor.userId,
        action: 'ProductBrandChanged',
        entityType: 'Product',
        entityId: productId,
        metadata: { before: before.brandId, after: dto.brandId },
      });
    }
    if (dto.categoryIds !== undefined) {
      await this.auditLogService.record({
        storeId,
        userId: actor.userId,
        action: 'ProductCategoriesChanged',
        entityType: 'Product',
        entityId: productId,
        metadata: { categoryIds: dto.categoryIds },
      });
    }
    if (dto.tagNames !== undefined) {
      await this.auditLogService.record({
        storeId,
        userId: actor.userId,
        action: 'ProductTagsChanged',
        entityType: 'Product',
        entityId: productId,
        metadata: { tagNames: dto.tagNames },
      });
    }
    if (dto.attributeIds !== undefined) {
      await this.auditLogService.record({
        storeId,
        userId: actor.userId,
        action: 'ProductAttributesChanged',
        entityType: 'Product',
        entityId: productId,
        metadata: { attributeIds: dto.attributeIds },
      });
    }
  }

  private async syncTags(
    tx: Prisma.TransactionClient,
    storeId: string,
    productId: string,
    tagNames: string[],
  ): Promise<void> {
    const tagIds: string[] = [];
    for (const rawName of tagNames) {
      const name = rawName.trim();
      if (!name) continue;
      const slug = slugify(name);
      const tag = await tx.tag.upsert({
        where: { storeId_slug: { storeId, slug } },
        update: {},
        create: { storeId, name, slug },
      });
      tagIds.push(tag.id);
    }
    if (tagIds.length) {
      await tx.productTag.createMany({
        data: tagIds.map((tagId) => ({ productId, tagId })),
        skipDuplicates: true,
      });
    }
  }

  private async validateBrand(storeId: string, brandId: string): Promise<void> {
    const brand = await this.prisma.brand.findFirst({ where: { id: brandId, storeId, deletedAt: null } });
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }
  }

  private async validateCategoryIds(storeId: string, categoryIds: string[]): Promise<void> {
    const found = await this.prisma.category.findMany({
      where: { id: { in: categoryIds }, storeId, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== new Set(categoryIds).size) {
      throw new NotFoundException('One or more categories were not found in this store');
    }
  }

  private async validateAttributeIds(storeId: string, attributeIds: string[]): Promise<void> {
    const found = await this.prisma.attribute.findMany({
      where: { id: { in: attributeIds }, storeId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (found.length !== new Set(attributeIds).size) {
      throw new NotFoundException('One or more attributes were not found or are inactive in this store');
    }
  }

  private async resolveSkuForCreate(storeId: string, productType: string, providedSku?: string): Promise<string | null> {
    if (productType === 'VARIABLE') {
      if (providedSku) {
        throw new BadRequestException('A variable product does not take a top-level SKU - set SKUs on its variants instead');
      }
      return null;
    }
    if (!providedSku) {
      throw new BadRequestException('SKU is required for a simple product');
    }
    const sku = this.normalizeSku(providedSku);
    if (await this.skuExistsAnywhere(storeId, sku)) {
      throw new ConflictException(`SKU "${sku}" is already in use in this store`);
    }
    return sku;
  }

  private async resolveSkuForUpdate(
    storeId: string,
    existing: { productType: string; sku: string | null },
    providedSku: string | undefined,
    excludeId: string,
  ): Promise<string | null> {
    if (providedSku === undefined) {
      return existing.sku;
    }
    if (existing.productType === 'VARIABLE') {
      throw new BadRequestException('A variable product does not take a top-level SKU - set SKUs on its variants instead');
    }
    if (!providedSku) {
      throw new BadRequestException('SKU is required for a simple product');
    }
    const sku = this.normalizeSku(providedSku);
    if (sku !== existing.sku && (await this.skuExistsAnywhere(storeId, sku, excludeId))) {
      throw new ConflictException(`SKU "${sku}" is already in use in this store`);
    }
    return sku;
  }

  private normalizeSku(sku: string): string {
    return sku.trim().toUpperCase();
  }

  /**
   * Product.sku and ProductVariant.sku are enforced unique by two SEPARATE DB
   * constraints (see Phase 2A notes) - a real store wants every SKU unique
   * regardless of which table it lives in, so this checks both explicitly.
   */
  private async skuExistsAnywhere(storeId: string, sku: string, excludeProductId?: string): Promise<boolean> {
    const [productMatch, variantMatch] = await Promise.all([
      this.prisma.product.findFirst({
        where: { storeId, sku, ...(excludeProductId ? { id: { not: excludeProductId } } : {}) },
        select: { id: true },
      }),
      this.prisma.productVariant.findFirst({ where: { storeId, sku }, select: { id: true } }),
    ]);
    return !!productMatch || !!variantMatch;
  }

  private async slugExists(storeId: string, slug: string, excludeId?: string): Promise<boolean> {
    const match = await this.prisma.product.findFirst({
      where: { storeId, slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return !!match;
  }

  private async resolveSlug(
    storeId: string,
    providedSlug: string | undefined,
    name: string,
    excludeId?: string,
  ): Promise<string> {
    if (providedSlug) {
      if (await this.slugExists(storeId, providedSlug, excludeId)) {
        throw new ConflictException(`Slug "${providedSlug}" is already in use in this store`);
      }
      return providedSlug;
    }
    return generateUniqueSlug(name, (candidate) => this.slugExists(storeId, candidate, excludeId));
  }

  private toListItem(product: ProductListRow) {
    const { categories, _count, ...rest } = product;
    return {
      ...rest,
      basePrice: rest.basePrice.toFixed(2),
      compareAtPrice: rest.compareAtPrice?.toFixed(2) ?? null,
      costPrice: rest.costPrice?.toFixed(2) ?? null,
      weight: rest.weight?.toFixed(3) ?? null,
      categories: categories.map((c) => c.category),
      variantCount: _count.variants,
    };
  }

  private toDetail(product: ProductDetailRow) {
    const { categories, tags, attributes, _count, ...rest } = product;
    return {
      ...rest,
      basePrice: rest.basePrice.toFixed(2),
      compareAtPrice: rest.compareAtPrice?.toFixed(2) ?? null,
      costPrice: rest.costPrice?.toFixed(2) ?? null,
      weight: rest.weight?.toFixed(3) ?? null,
      categories: categories.map((c) => c.category),
      tags: tags.map((t) => t.tag),
      attributes: attributes.map((a) => a.attribute),
      variantCount: _count.variants,
    };
  }

  private translateWriteError(error: unknown): Error {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === PRISMA_UNIQUE_CONSTRAINT_ERROR
    ) {
      return new ConflictException('This slug or SKU is already in use (concurrent write detected)');
    }
    return error as Error;
  }
}
