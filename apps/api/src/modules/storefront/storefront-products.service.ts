import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate } from '../../common/utils/pagination.util';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PublicProductQueryDto } from './dto/public-product-query.dto';
import { StorefrontCategoriesService } from './storefront-categories.service';
import { StorefrontInventoryService } from './storefront-inventory.service';
import { combineAvailability, computeAvailability, PublicAvailability } from './utils/availability.util';

/**
 * Only ever ACTIVE, non-deleted products/variants ever reach a customer -
 * this is the one enforcement point for that rule, applied server-side in
 * every method below (never left to the frontend to filter out).
 */
const PRODUCT_WHERE_BASE: { status: 'ACTIVE'; deletedAt: null } = { status: 'ACTIVE', deletedAt: null };
const VARIANT_WHERE_BASE: { status: 'ACTIVE'; deletedAt: null } = { status: 'ACTIVE', deletedAt: null };

const LIST_SELECT = {
  id: true,
  slug: true,
  name: true,
  shortDescription: true,
  productType: true,
  basePrice: true,
  compareAtPrice: true,
  isFeatured: true,
  isBestseller: true,
  isNewArrival: true,
  createdAt: true,
  brand: { select: { id: true, name: true, slug: true } },
  categories: { select: { category: { select: { id: true, name: true, slug: true } } } },
  images: {
    where: { isPrimary: true, isActive: true },
    take: 1,
    select: { url: true, altText: true },
  },
} satisfies Prisma.ProductSelect;

export type ListRow = Prisma.ProductGetPayload<{ select: typeof LIST_SELECT }>;

interface FilterExtras {
  categoryIds?: string[];
  brandId?: string;
}

@Injectable()
export class StorefrontProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categoriesService: StorefrontCategoriesService,
    private readonly inventoryService: StorefrontInventoryService,
  ) {}

  async findProducts(storeId: string, query: PublicProductQueryDto) {
    const extras: FilterExtras = {};

    if (query.categorySlug) {
      const category = await this.prisma.category.findFirst({
        where: { storeId, slug: query.categorySlug, deletedAt: null, isActive: true },
        select: { id: true },
      });
      // An unknown/inactive category slug used as a filter yields an empty
      // result set, not a 404 - it's a query parameter, not a resource path.
      if (!category) return paginate([], 0, query.page, query.pageSize);
      extras.categoryIds = await this.categoriesService.getSelfAndDescendantIds(storeId, category.id);
    }

    if (query.brandSlug) {
      const brand = await this.prisma.brand.findFirst({
        where: { storeId, slug: query.brandSlug, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!brand) return paginate([], 0, query.page, query.pageSize);
      extras.brandId = brand.id;
    }

    return this.listByFilters(storeId, query, extras);
  }

  async findByCategoryId(storeId: string, categoryId: string, query: PaginationQueryDto) {
    const categoryIds = await this.categoriesService.getSelfAndDescendantIds(storeId, categoryId);
    return this.listByFilters(storeId, query, { categoryIds });
  }

  async findByBrandId(storeId: string, brandId: string, query: PaginationQueryDto) {
    return this.listByFilters(storeId, query, { brandId });
  }

  async getFeatured(storeId: string, limit: number) {
    return this.mapRows(
      storeId,
      await this.prisma.product.findMany({
        where: { storeId, ...PRODUCT_WHERE_BASE, isFeatured: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: LIST_SELECT,
      }),
    );
  }

  async getBestsellers(storeId: string, limit: number) {
    return this.mapRows(
      storeId,
      await this.prisma.product.findMany({
        where: { storeId, ...PRODUCT_WHERE_BASE, isBestseller: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: LIST_SELECT,
      }),
    );
  }

  async getNewArrivals(storeId: string, limit: number) {
    return this.mapRows(
      storeId,
      await this.prisma.product.findMany({
        where: { storeId, ...PRODUCT_WHERE_BASE, isNewArrival: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: LIST_SELECT,
      }),
    );
  }

  async getBySlug(storeId: string, slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { storeId, slug, ...PRODUCT_WHERE_BASE },
      select: {
        ...LIST_SELECT,
        description: true,
        seoTitle: true,
        seoDescription: true,
        images: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: { url: true, altText: true, caption: true, sortOrder: true, isPrimary: true },
        },
        attributes: {
          select: { attribute: { select: { id: true, name: true, type: true, sortOrder: true } } },
        },
        variants: {
          where: VARIANT_WHERE_BASE,
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            sku: true,
            price: true,
            compareAtPrice: true,
            image: true,
            attributeValues: {
              select: {
                attributeValue: {
                  select: { id: true, value: true, sortOrder: true, attributeId: true },
                },
              },
            },
            images: {
              where: { isActive: true },
              orderBy: { sortOrder: 'asc' },
              select: { url: true, altText: true },
            },
          },
        },
      },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const { description, seoTitle, seoDescription, images, attributes, variants, ...listFields } = product;
    const primaryImage = images.find((img) => img.isPrimary) ?? images[0] ?? null;

    const inventoryIds = [product.id];
    const inventoryMap = await this.inventoryService.getBulkAvailability(storeId, inventoryIds);

    let variantResponses: Array<{
      id: string;
      sku: string;
      price: string;
      compareAtPrice: string | null;
      image: string | null;
      images: { url: string; altText: string | null }[];
      availability: PublicAvailability;
      attributeValueIds: string[];
    }> = [];
    let productAvailability: PublicAvailability;

    if (product.productType === 'VARIABLE') {
      // A VARIABLE product's inventory lives on each variant (keyed by
      // variantId), not on the product itself - the bulk map fetched above
      // for `[product.id]` already contains every one of those rows (the
      // groupBy is scoped by productId, not by variantId), so each variant's
      // sum is just a lookup, never an extra query.
      variantResponses = variants.map((v) => {
        const sum = inventoryMap.get(`${product.id}:${v.id}`) ?? { available: 0, threshold: 0 };
        return {
          id: v.id,
          sku: v.sku,
          price: v.price.toFixed(2),
          compareAtPrice: v.compareAtPrice?.toFixed(2) ?? null,
          image: v.image,
          images: v.images,
          availability: computeAvailability(sum.available, sum.threshold),
          attributeValueIds: v.attributeValues.map((av) => av.attributeValue.id),
        };
      });
      productAvailability = combineAvailability(variantResponses.map((v) => v.availability));
    } else {
      const sum = inventoryMap.get(`${product.id}:simple`) ?? { available: 0, threshold: 0 };
      productAvailability = computeAvailability(sum.available, sum.threshold);
    }

    // Deduped, attribute-grouped option lists built only from values that
    // appear on at least one ACTIVE variant - a value used only by a
    // discontinued/inactive variant never shows up as a selectable option.
    const optionsByAttribute = new Map<
      string,
      { attributeId: string; attributeName: string; type: string; sortOrder: number; values: Map<string, { valueId: string; label: string; sortOrder: number }> }
    >();
    for (const variant of variants) {
      for (const av of variant.attributeValues) {
        const attribute = attributes.find((a) => a.attribute.id === av.attributeValue.attributeId)?.attribute;
        if (!attribute) continue;
        if (!optionsByAttribute.has(attribute.id)) {
          optionsByAttribute.set(attribute.id, {
            attributeId: attribute.id,
            attributeName: attribute.name,
            type: attribute.type,
            sortOrder: attribute.sortOrder,
            values: new Map(),
          });
        }
        optionsByAttribute.get(attribute.id)!.values.set(av.attributeValue.id, {
          valueId: av.attributeValue.id,
          label: av.attributeValue.value,
          sortOrder: av.attributeValue.sortOrder,
        });
      }
    }
    const options = Array.from(optionsByAttribute.values())
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((opt) => ({
        attributeId: opt.attributeId,
        attributeName: opt.attributeName,
        type: opt.type,
        values: Array.from(opt.values.values())
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(({ valueId, label }) => ({ valueId, label })),
      }));

    const listRowWithPrimary = { ...listFields, images: primaryImage ? [primaryImage] : [] } as ListRow;

    return {
      ...this.mapListRow(
        listRowWithPrimary,
        productAvailability,
        product.productType === 'SIMPLE' ? undefined : variantResponses.map((v) => v.price),
      ),
      description,
      seoTitle,
      seoDescription,
      images,
      options,
      variants: variantResponses,
    };
  }

  /**
   * Hydrates raw LIST_SELECT rows (availability + VARIABLE price range,
   * batched once for the whole set) into the same public list-item shape
   * every other storefront listing returns. Exposed so StorefrontSearchService
   * can reuse this exact pipeline instead of duplicating it - a search result
   * row must look identical to a /storefront/products row for the same
   * product.
   */
  async hydrateListRows(storeId: string, rows: ListRow[]) {
    return this.mapRows(storeId, rows);
  }

  /** The exact LIST_SELECT shape, exposed so callers building their own raw-SQL id lists can select full rows for hydration. */
  static readonly LIST_SELECT = LIST_SELECT;

  private async listByFilters(
    storeId: string,
    query: PaginationQueryDto & { sortBy?: string; minPrice?: number; maxPrice?: number; featured?: boolean; bestseller?: boolean; newArrival?: boolean },
    extras: FilterExtras,
  ) {
    const where: Prisma.ProductWhereInput = {
      storeId,
      ...PRODUCT_WHERE_BASE,
      ...(extras.categoryIds ? { categories: { some: { categoryId: { in: extras.categoryIds } } } } : {}),
      ...(extras.brandId ? { brandId: extras.brandId } : {}),
      // Price filtering (and sorting) uses basePrice for every product type,
      // including VARIABLE ones (which always carry a basePrice as their
      // default/starting price) - filtering on a true per-variant min/max
      // range would need a raw aggregate query and is left for a later pass.
      ...(query.minPrice !== undefined || query.maxPrice !== undefined
        ? { basePrice: { ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}), ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}) } }
        : {}),
      ...(query.featured !== undefined ? { isFeatured: query.featured } : {}),
      ...(query.bestseller !== undefined ? { isBestseller: query.bestseller } : {}),
      ...(query.newArrival !== undefined ? { isNewArrival: query.newArrival } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { shortDescription: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const sortField = query.sortBy === 'price' ? 'basePrice' : query.sortBy === 'name' ? 'name' : 'createdAt';

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: { [sortField]: query.sortOrder ?? 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: LIST_SELECT,
      }),
      this.prisma.product.count({ where }),
    ]);

    return paginate(await this.mapRows(storeId, items), total, query.page, query.pageSize);
  }

  private async mapRows(storeId: string, rows: ListRow[]) {
    const productIds = rows.map((r) => r.id);
    const inventoryMap = await this.inventoryService.getBulkAvailability(storeId, productIds);
    const ratingByProduct = await this.getRatingSummaries(storeId, productIds);

    // VARIABLE products price off their variant range, not basePrice - loaded
    // in one grouped query for the whole page rather than one per product.
    const variableIds = rows.filter((r) => r.productType === 'VARIABLE').map((r) => r.id);
    const priceRanges = variableIds.length
      ? await this.prisma.productVariant.groupBy({
          by: ['productId'],
          where: { productId: { in: variableIds }, ...VARIANT_WHERE_BASE },
          _min: { price: true },
          _max: { price: true },
        })
      : [];
    const priceRangeByProduct = new Map(priceRanges.map((r) => [r.productId, r]));

    // Groups the same bulk inventory map by productId so a VARIABLE product's
    // card badge combines ALL of its variants' availabilities in-memory,
    // without a second query per product (or per page).
    const variantAvailabilityByProduct = new Map<string, PublicAvailability[]>();
    for (const [mapKey, sum] of inventoryMap.entries()) {
      const separatorIndex = mapKey.lastIndexOf(':');
      const productId = mapKey.slice(0, separatorIndex);
      const variantPart = mapKey.slice(separatorIndex + 1);
      if (variantPart === 'simple') continue;
      const list = variantAvailabilityByProduct.get(productId) ?? [];
      list.push(computeAvailability(sum.available, sum.threshold));
      variantAvailabilityByProduct.set(productId, list);
    }

    return rows.map((row) => {
      const range = priceRangeByProduct.get(row.id);
      const prices = range ? [range._min.price?.toString(), range._max.price?.toString()].filter((p): p is string => !!p) : undefined;

      let availability: PublicAvailability;
      if (row.productType === 'SIMPLE') {
        const sum = inventoryMap.get(`${row.id}:simple`) ?? { available: 0, threshold: 0 };
        availability = computeAvailability(sum.available, sum.threshold);
      } else {
        availability = combineAvailability(variantAvailabilityByProduct.get(row.id) ?? []);
      }

      return this.mapListRow(row, availability, prices, ratingByProduct.get(row.id));
    });
  }

  /**
   * Batched, single-query rating aggregate for a page of products - same
   * groupBy shape and the same "what counts as a visible review" rule
   * (APPROVED, not deleted) as ReviewsService.getRatingSummary, just grouped
   * by product instead of computed for one. Never one query per product.
   */
  private async getRatingSummaries(storeId: string, productIds: string[]) {
    if (productIds.length === 0) return new Map<string, { average: number; count: number }>();

    const grouped = await this.prisma.productReview.groupBy({
      by: ['productId'],
      where: { storeId, productId: { in: productIds }, status: 'APPROVED', deletedAt: null },
      _avg: { rating: true },
      _count: { _all: true },
    });

    return new Map(
      grouped
        .filter((g): g is typeof g & { productId: string } => g.productId !== null)
        .map((g) => [g.productId, { average: Number((g._avg.rating ?? 0).toFixed(2)), count: g._count._all }]),
    );
  }

  private mapListRow(
    row: ListRow,
    availability: PublicAvailability,
    variantPrices?: string[],
    rating?: { average: number; count: number },
  ) {
    const { brand, categories, images, ...rest } = row;

    let priceRange: { min: string; max: string } | undefined;
    if (row.productType === 'VARIABLE' && variantPrices?.length) {
      const numeric = variantPrices.map(Number);
      priceRange = { min: Math.min(...numeric).toFixed(2), max: Math.max(...numeric).toFixed(2) };
    }

    return {
      ...rest,
      basePrice: rest.basePrice.toFixed(2),
      compareAtPrice: rest.compareAtPrice?.toFixed(2) ?? null,
      priceRange,
      brand,
      categories: categories.map((c) => c.category),
      primaryImage: images[0] ?? null,
      availability,
      rating: rating?.count ? rating.average : null,
      reviewCount: rating?.count ?? 0,
    };
  }
}
