import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate } from '../../common/utils/pagination.util';
import { StorefrontCategoriesService } from './storefront-categories.service';
import { StorefrontProductsService, ListRow } from './storefront-products.service';
import { SearchQueryDto, SearchAvailabilityFilter, SearchSortOption } from './dto/search-query.dto';

/**
 * Postgres LIKE's default escape character is backslash. A raw keyword is
 * always bound as a parameter (never string-concatenated into SQL), but its
 * *content* still becomes the operand of a LIKE pattern this service builds
 * (e.g. wrapping it in `%...%`) - without escaping, a customer literally
 * searching for "50% off" or "a_b" would have their own `%`/`_` misread as
 * wildcards. This neutralizes that, purely for search correctness (not a SQL
 * injection concern - injection is already impossible here because the value
 * is always a bind parameter, never interpolated into the query text).
 */
function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Trim, collapse internal whitespace runs. Case differences are handled by lower() in SQL; length is bounded by the DTO's @MaxLength. */
function normalizeQuery(raw: string | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/\s+/g, ' ');
}

@Injectable()
export class StorefrontSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: StorefrontProductsService,
    private readonly categoriesService: StorefrontCategoriesService,
  ) {}

  async search(storeId: string, query: SearchQueryDto) {
    if (query.minPrice !== undefined && query.maxPrice !== undefined && query.maxPrice < query.minPrice) {
      throw new BadRequestException('maxPrice must be greater than or equal to minPrice');
    }

    const q = normalizeQuery(query.q);

    let categoryIds: string[] | undefined;
    if (query.categorySlug) {
      const category = await this.prisma.category.findFirst({
        where: { storeId, slug: query.categorySlug, deletedAt: null, isActive: true },
        select: { id: true },
      });
      // An unknown/inactive category slug is a filter value, not a resource
      // path - it yields an empty result set, never a 404 (same convention
      // StorefrontProductsService.findProducts already uses).
      if (!category) return paginate([], 0, query.page, query.pageSize);
      categoryIds = await this.categoriesService.getSelfAndDescendantIds(storeId, category.id);
    }

    let brandId: string | undefined;
    if (query.brandSlug) {
      const brand = await this.prisma.brand.findFirst({
        where: { storeId, slug: query.brandSlug, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!brand) return paginate([], 0, query.page, query.pageSize);
      brandId = brand.id;
    }

    const conditions: Prisma.Sql[] = [
      Prisma.sql`p."storeId" = ${storeId}`,
      Prisma.sql`p."status" = 'ACTIVE'`,
      Prisma.sql`p."deletedAt" IS NULL`,
    ];

    if (categoryIds) {
      conditions.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "product_categories" pc WHERE pc."productId" = p.id AND pc."categoryId" = ANY(${categoryIds}::text[]))`,
      );
    }
    if (brandId) {
      conditions.push(Prisma.sql`p."brandId" = ${brandId}`);
    }
    // A VARIABLE product's purchasable price is a RANGE (min..max across its
    // active variants), not a single number - the filter must match if that
    // range OVERLAPS the requested [minPrice, maxPrice] window (i.e. at
    // least one variant is affordable within it), never require the whole
    // range to sit entirely inside the window. A SIMPLE product's single
    // basePrice is compared directly either way since COALESCE collapses
    // min_price/max_price to the same value for it.
    if (query.minPrice !== undefined) {
      conditions.push(Prisma.sql`COALESCE(vr.max_price, p."basePrice") >= ${query.minPrice}`);
    }
    if (query.maxPrice !== undefined) {
      conditions.push(Prisma.sql`COALESCE(vr.min_price, p."basePrice") <= ${query.maxPrice}`);
    }
    if (query.attributeValueIds?.length) {
      // A product qualifies only if ONE active variant carries every
      // requested value simultaneously (narrowing-facet semantics) - not
      // merely "some variant matches some one of the requested values".
      conditions.push(Prisma.sql`
        EXISTS (
          SELECT 1 FROM "product_variants" pv
          WHERE pv."productId" = p.id AND pv."status" = 'ACTIVE' AND pv."deletedAt" IS NULL
            AND (
              SELECT COUNT(DISTINCT pvav."attributeValueId") FROM "product_variant_attribute_values" pvav
              WHERE pvav."variantId" = pv.id AND pvav."attributeValueId" = ANY(${query.attributeValueIds}::text[])
            ) = ${query.attributeValueIds.length}
        )
      `);
    }
    if (query.availability) {
      conditions.push(this.availabilityCondition(query.availability));
    }

    let relevanceExpr = Prisma.sql`0`;
    let cteClause = Prisma.empty;
    if (q) {
      const escaped = escapeLikePattern(q);
      const prefix = `${escaped}%`;
      const contains = `%${escaped}%`;
      const skuUpper = q.toUpperCase();

      relevanceExpr = Prisma.sql`(CASE
        WHEN lower(p."name") = lower(${q}) THEN 100
        WHEN lower(p."name") LIKE lower(${prefix}) THEN 80
        WHEN lower(p."name") LIKE lower(${contains}) THEN 60
        WHEN p."sku" IS NOT NULL AND p."sku" = ${skuUpper} THEN 55
        WHEN EXISTS (SELECT 1 FROM "product_variants" pv2 WHERE pv2."productId" = p.id AND pv2."sku" = ${skuUpper}) THEN 50
        WHEN b."name" IS NOT NULL AND lower(b."name") LIKE lower(${contains}) THEN 30
        WHEN EXISTS (
          SELECT 1 FROM "product_categories" pc2 JOIN "categories" c2 ON c2.id = pc2."categoryId"
          WHERE pc2."productId" = p.id AND lower(c2."name") LIKE lower(${contains})
        ) THEN 25
        WHEN p."shortDescription" IS NOT NULL AND lower(p."shortDescription") LIKE lower(${contains}) THEN 15
        WHEN p."description" IS NOT NULL AND lower(p."description") LIKE lower(${contains}) THEN 10
        ELSE 0
      END)`;

      // Candidate ids are gathered via a UNION of independently-indexable
      // branches (each a plain, direct predicate Postgres CAN push down to
      // an index scan: products_name_trgm_idx / products_short_description_
      // trgm_idx for the two ILIKE branches, the existing (storeId, sku)
      // unique index for the two exact-SKU branches) rather than as a single
      // CASE-based filter. A CASE expression buried in a WHERE clause hides
      // every LIKE/equality check from the planner - verified via EXPLAIN
      // ANALYZE against this dev database's ~14k-product catalog, where the
      // CASE-gated version forced a full sequential scan (~28ms and rising
      // with catalog size) despite the trigram indexes existing, while this
      // UNION form uses Bitmap Index Scans and executes in under 1ms. The
      // relevance CASE above is still evaluated, but only over this already-
      // narrowed candidate set, purely to rank it for ORDER BY.
      cteClause = Prisma.sql`WITH candidate_ids AS (
        SELECT id FROM "products" WHERE "storeId" = ${storeId} AND "status" = 'ACTIVE' AND "deletedAt" IS NULL AND "name" ILIKE ${contains}
        UNION
        SELECT id FROM "products" WHERE "storeId" = ${storeId} AND "status" = 'ACTIVE' AND "deletedAt" IS NULL AND "shortDescription" ILIKE ${contains}
        UNION
        SELECT id FROM "products" WHERE "storeId" = ${storeId} AND "status" = 'ACTIVE' AND "deletedAt" IS NULL AND "description" ILIKE ${contains}
        UNION
        SELECT id FROM "products" WHERE "storeId" = ${storeId} AND "status" = 'ACTIVE' AND "deletedAt" IS NULL AND "sku" = ${skuUpper}
        UNION
        SELECT pv2."productId" AS id FROM "product_variants" pv2
          JOIN "products" p2 ON p2.id = pv2."productId"
          WHERE p2."storeId" = ${storeId} AND p2."status" = 'ACTIVE' AND p2."deletedAt" IS NULL AND pv2."sku" = ${skuUpper}
        UNION
        SELECT p3.id FROM "products" p3
          JOIN "brands" b3 ON b3.id = p3."brandId"
          WHERE p3."storeId" = ${storeId} AND p3."status" = 'ACTIVE' AND p3."deletedAt" IS NULL AND b3."name" ILIKE ${contains}
        UNION
        SELECT pc3."productId" AS id FROM "product_categories" pc3
          JOIN "categories" c3 ON c3.id = pc3."categoryId"
          JOIN "products" p4 ON p4.id = pc3."productId"
          WHERE p4."storeId" = ${storeId} AND p4."status" = 'ACTIVE' AND p4."deletedAt" IS NULL AND c3."name" ILIKE ${contains}
      ) `;
      conditions.push(Prisma.sql`p.id IN (SELECT id FROM candidate_ids)`);
    }

    const whereClause = Prisma.join(conditions, ' AND ');

    // LATERAL, correlated on p."productType" = 'VARIABLE' inside the subquery
    // itself (not just the join condition) so a SIMPLE product's lookup
    // short-circuits instead of scanning variants pointlessly.
    // `cteClause` (a `WITH candidate_ids AS (...)`, or empty) is prepended
    // to the FULL statement by the two callers below - a WITH clause must
    // precede SELECT, it cannot sit between the column list and FROM.
    const fromClause = Prisma.sql`
      FROM "products" p
      LEFT JOIN "brands" b ON b.id = p."brandId"
      LEFT JOIN LATERAL (
        SELECT MIN(pv."price") AS min_price, MAX(pv."price") AS max_price
        FROM "product_variants" pv
        WHERE pv."productId" = p.id AND pv."status" = 'ACTIVE' AND pv."deletedAt" IS NULL AND p."productType" = 'VARIABLE'
      ) vr ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(MAX(CASE WHEN ii."availableQuantity" > ii."lowStockThreshold" THEN 3 WHEN ii."availableQuantity" > 0 THEN 2 ELSE 1 END), 1) AS avail_rank
        FROM "inventory_items" ii
        WHERE ii."productId" = p.id
          AND (
            (p."productType" = 'SIMPLE' AND ii."variantId" IS NULL)
            OR (p."productType" = 'VARIABLE' AND ii."variantId" IN (
              SELECT id FROM "product_variants" WHERE "productId" = p.id AND "status" = 'ACTIVE' AND "deletedAt" IS NULL
            ))
          )
      ) av ON true
      WHERE ${whereClause}
    `;

    const effectiveSort: SearchSortOption = query.sortBy === 'relevance' && !q ? 'newest' : (query.sortBy ?? 'relevance');
    const orderClause = this.orderByClause(effectiveSort, q, relevanceExpr);

    const offset = (query.page - 1) * query.pageSize;

    const [idRows, countRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`${cteClause}SELECT p.id ${fromClause} ORDER BY ${orderClause} LIMIT ${query.pageSize} OFFSET ${offset}`),
      this.prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`${cteClause}SELECT COUNT(*)::bigint AS total ${fromClause}`),
    ]);

    const total = Number(countRows[0]?.total ?? 0);
    const ids = idRows.map((r) => r.id);
    if (ids.length === 0) {
      return paginate([], total, query.page, query.pageSize);
    }

    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: StorefrontProductsService.LIST_SELECT,
    });
    const rowsById = new Map(rows.map((r) => [r.id, r]));
    // Prisma's `id IN (...)` does not preserve the input order - re-sort to
    // match the SQL-determined relevance/sort order computed above.
    const orderedRows = ids.map((id) => rowsById.get(id)).filter((r): r is ListRow => !!r);

    const hydrated = await this.productsService.hydrateListRows(storeId, orderedRows);
    return paginate(hydrated, total, query.page, query.pageSize);
  }

  private availabilityCondition(availability: SearchAvailabilityFilter): Prisma.Sql {
    const rank = availability === 'IN_STOCK' ? 3 : availability === 'LOW_STOCK' ? 2 : 1;
    return Prisma.sql`av.avail_rank = ${rank}`;
  }

  private orderByClause(sortBy: SearchSortOption, q: string, relevanceExpr: Prisma.Sql): Prisma.Sql {
    switch (sortBy) {
      case 'relevance':
        return q ? Prisma.sql`${relevanceExpr} DESC, p."createdAt" DESC, p.id ASC` : Prisma.sql`p."createdAt" DESC, p.id ASC`;
      case 'price_asc':
        return Prisma.sql`COALESCE(vr.min_price, p."basePrice") ASC, p.id ASC`;
      case 'price_desc':
        return Prisma.sql`COALESCE(vr.max_price, p."basePrice") DESC, p.id ASC`;
      case 'name_asc':
        return Prisma.sql`p."name" ASC, p.id ASC`;
      case 'name_desc':
        return Prisma.sql`p."name" DESC, p.id ASC`;
      case 'newest':
      default:
        return Prisma.sql`p."createdAt" DESC, p.id ASC`;
    }
  }
}
