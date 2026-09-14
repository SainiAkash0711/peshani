import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate } from '../../common/utils/pagination.util';
import { PublicBlogPostQueryDto } from './dto/public-blog-post-query.dto';

const SUMMARY_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverImageUrl: true,
  authorName: true,
  tags: true,
  publishedAt: true,
} satisfies Prisma.BlogPostSelect;

const RECENT_POSTS_LIMIT = 3;

/**
 * Only ever PUBLISHED posts reach a customer - the one enforcement point
 * for that rule, applied server-side in every method below (mirrors
 * StorefrontProductsService's identical ACTIVE-only enforcement).
 */
@Injectable()
export class StorefrontBlogService {
  constructor(private readonly prisma: PrismaService) {}

  async findPublished(storeId: string, query: PublicBlogPostQueryDto) {
    const where: Prisma.BlogPostWhereInput = {
      storeId,
      status: 'PUBLISHED',
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { excerpt: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.blogPost.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: SUMMARY_SELECT,
      }),
      this.prisma.blogPost.count({ where }),
    ]);

    return paginate(items, total, query.page, query.pageSize);
  }

  async findPublishedBySlug(storeId: string, slug: string) {
    const post = await this.prisma.blogPost.findFirst({
      where: { storeId, slug, status: 'PUBLISHED' },
    });
    if (!post) {
      throw new NotFoundException('Blog post not found');
    }
    return post;
  }

  /** Feeds the blog listing page's sidebar: latest posts + every tag in use. */
  async getSidebar(storeId: string) {
    const [recentPosts, tagRows] = await Promise.all([
      this.prisma.blogPost.findMany({
        where: { storeId, status: 'PUBLISHED' },
        orderBy: { publishedAt: 'desc' },
        take: RECENT_POSTS_LIMIT,
        select: SUMMARY_SELECT,
      }),
      this.prisma.blogPost.findMany({
        where: { storeId, status: 'PUBLISHED' },
        select: { tags: true },
      }),
    ]);

    const tags = Array.from(new Set(tagRows.flatMap((row) => row.tags))).sort((a, b) => a.localeCompare(b));

    return { recentPosts, tags };
  }
}
