import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MediaUploadService } from '../../common/media/media-upload.service';
import { generateUniqueSlug } from '../../common/utils/slug.util';
import { paginate } from '../../common/utils/pagination.util';
import { sanitizeRichTextHtml } from '../../common/utils/html-sanitizer.util';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { QueryBlogPostDto } from './dto/query-blog-post.dto';

@Injectable()
export class BlogPostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly mediaUpload: MediaUploadService,
  ) {}

  async create(storeId: string, dto: CreateBlogPostDto, actor: AuthenticatedUser) {
    const slug = await this.resolveSlug(storeId, dto.slug, dto.title);
    const status = dto.status ?? 'DRAFT';

    const post = await this.prisma.blogPost.create({
      data: {
        storeId,
        title: dto.title,
        slug,
        excerpt: dto.excerpt,
        content: sanitizeRichTextHtml(dto.content),
        authorName: dto.authorName,
        tags: dto.tags ?? [],
        status,
        publishedAt: status === 'PUBLISHED' ? new Date() : null,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'BlogPostCreated',
      entityType: 'BlogPost',
      entityId: post.id,
      metadata: { after: post },
    });

    return post;
  }

  async findAll(storeId: string, query: QueryBlogPostDto) {
    const where: Prisma.BlogPostWhereInput = {
      storeId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.blogPost.findMany({
        where,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.blogPost.count({ where }),
    ]);

    return paginate(items, total, query.page, query.pageSize);
  }

  async findOne(storeId: string, id: string) {
    return this.getScopedPostOrThrow(storeId, id);
  }

  async update(storeId: string, id: string, dto: UpdateBlogPostDto, actor: AuthenticatedUser) {
    const existing = await this.getScopedPostOrThrow(storeId, id);

    let slug = existing.slug;
    if (dto.slug) {
      slug = await this.resolveSlug(storeId, dto.slug, dto.title ?? existing.title, id);
    } else if (dto.title && dto.title !== existing.title) {
      slug = await generateUniqueSlug(dto.title, (candidate) => this.slugExists(storeId, candidate, id));
    }

    const nextStatus = dto.status ?? existing.status;
    // Publishing for the first time stamps `publishedAt` now; moving back to
    // DRAFT and later re-publishing keeps the original date rather than
    // bumping it, so a post's "published on" date reflects when it first
    // went live, not its most recent edit.
    const publishedAt =
      nextStatus === 'PUBLISHED' && !existing.publishedAt ? new Date() : existing.publishedAt;

    const updated = await this.prisma.blogPost.update({
      where: { id: existing.id },
      data: {
        title: dto.title ?? existing.title,
        slug,
        excerpt: dto.excerpt !== undefined ? dto.excerpt : existing.excerpt,
        content: dto.content !== undefined ? sanitizeRichTextHtml(dto.content) : existing.content,
        authorName: dto.authorName !== undefined ? dto.authorName : existing.authorName,
        tags: dto.tags ?? existing.tags,
        status: nextStatus,
        publishedAt,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'BlogPostUpdated',
      entityType: 'BlogPost',
      entityId: updated.id,
      metadata: { before: existing, after: updated },
    });

    return updated;
  }

  async uploadCoverImage(storeId: string, id: string, file: Express.Multer.File | undefined, actor: AuthenticatedUser) {
    const existing = await this.getScopedPostOrThrow(storeId, id);
    const validated = await this.mediaUpload.validate(file);

    const key = `stores/${storeId}/blog-posts/${randomUUID()}${validated.extension}`;
    const uploadResult = await this.mediaUpload.upload(key, validated);

    const updated = await this.prisma.blogPost.update({
      where: { id: existing.id },
      data: {
        coverImageUrl: uploadResult.url,
        storageKey: key,
        originalFilename: file!.originalname?.slice(0, 255),
        mimeType: validated.mimeType,
        fileSize: validated.size,
        width: validated.width,
        height: validated.height,
        contentHash: validated.contentHash,
      },
    });

    // Old cover image (if any) is now orphaned - best-effort cleanup after
    // the DB already points at the new one, same ordering as HomepageSlide's
    // delete flow.
    if (existing.storageKey) await this.mediaUpload.safeDelete(existing.storageKey);

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'BlogPostCoverImageUploaded',
      entityType: 'BlogPost',
      entityId: updated.id,
      metadata: { mimeType: updated.mimeType, fileSize: updated.fileSize },
    });

    return updated;
  }

  async remove(storeId: string, id: string, actor: AuthenticatedUser) {
    const existing = await this.getScopedPostOrThrow(storeId, id);

    await this.prisma.blogPost.delete({ where: { id: existing.id } });
    if (existing.storageKey) await this.mediaUpload.safeDelete(existing.storageKey);

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'BlogPostDeleted',
      entityType: 'BlogPost',
      entityId: existing.id,
      metadata: { before: existing },
    });

    return { id: existing.id };
  }

  private async getScopedPostOrThrow(storeId: string, id: string) {
    const post = await this.prisma.blogPost.findFirst({ where: { id, storeId } });
    if (!post) {
      throw new NotFoundException('Blog post not found');
    }
    return post;
  }

  private async resolveSlug(storeId: string, providedSlug: string | undefined, title: string, excludeId?: string): Promise<string> {
    if (providedSlug) {
      return generateUniqueSlug(providedSlug, (candidate) => this.slugExists(storeId, candidate, excludeId));
    }
    return generateUniqueSlug(title, (candidate) => this.slugExists(storeId, candidate, excludeId));
  }

  private async slugExists(storeId: string, slug: string, excludeId?: string): Promise<boolean> {
    const match = await this.prisma.blogPost.findFirst({
      where: { storeId, slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return !!match;
  }
}
