import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const PRODUCTS_PAGE_SIZE = 500;

export interface SitemapEntry {
  slug: string;
  updatedAt: string;
}

export interface SitemapProductsPage {
  items: SitemapEntry[];
  nextCursor: string | null;
}

/**
 * Feeds apps/web's sitemap generator. Deliberately separate from the
 * customer-facing storefront controllers (never registered under a `:slug`
 * catch-all route, which would otherwise shadow a literal `sitemap` path
 * segment) and from the admin catalog APIs. Every method is read-only,
 * ACTIVE + non-deleted + store-scoped only - the same visibility rule as
 * every other storefront endpoint - and returns nothing beyond a slug and a
 * last-modified timestamp, since that is all a sitemap entry needs.
 */
@Injectable()
export class StorefrontSitemapService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Keyset-paginated (by id, not offset) so a large catalog can be fully
   * walked by the sitemap generator in bounded-size batches without ever
   * loading the whole table into memory at once.
   */
  async getProductsPage(storeId: string, cursor: string | undefined, limit = PRODUCTS_PAGE_SIZE): Promise<SitemapProductsPage> {
    const rows = await this.prisma.product.findMany({
      where: { storeId, status: 'ACTIVE', deletedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, slug: true, updatedAt: true },
    });
    return {
      items: rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt.toISOString() })),
      nextCursor: rows.length === limit ? rows[rows.length - 1].id : null,
    };
  }

  /** Categories and brands are, in any real store, small enough to return in one page - no keyset pagination needed. */
  async getAllCategories(storeId: string): Promise<SitemapEntry[]> {
    const rows = await this.prisma.category.findMany({
      where: { storeId, isActive: true, deletedAt: null },
      orderBy: { id: 'asc' },
      select: { slug: true, updatedAt: true },
    });
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt.toISOString() }));
  }

  async getAllBrands(storeId: string): Promise<SitemapEntry[]> {
    const rows = await this.prisma.brand.findMany({
      where: { storeId, isActive: true, deletedAt: null },
      orderBy: { id: 'asc' },
      select: { slug: true, updatedAt: true },
    });
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt.toISOString() }));
  }
}
