import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MediaUploadService } from '../../common/media/media-upload.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { UpdateHomepageSlideDto } from './dto/update-homepage-slide.dto';
import { ReorderItemsDto } from '../../common/dto/reorder-items.dto';

@Injectable()
export class HomepageSlidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly mediaUpload: MediaUploadService,
  ) {}

  async upload(storeId: string, file: Express.Multer.File | undefined, dto: UpdateHomepageSlideDto, actor: AuthenticatedUser) {
    const validated = await this.mediaUpload.validate(file);

    const key = `stores/${storeId}/homepage-slides/${randomUUID()}${validated.extension}`;
    const uploadResult = await this.mediaUpload.upload(key, validated);

    const existingCount = await this.prisma.homepageSlide.count({ where: { storeId } });

    const slide = await this.prisma.homepageSlide.create({
      data: {
        storeId,
        imageUrl: uploadResult.url,
        storageKey: key,
        originalFilename: file!.originalname?.slice(0, 255),
        mimeType: validated.mimeType,
        fileSize: validated.size,
        width: validated.width,
        height: validated.height,
        contentHash: validated.contentHash,
        title: dto.title,
        subtitle: dto.subtitle,
        linkUrl: dto.linkUrl,
        sortOrder: existingCount,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'HomepageSlideUploaded',
      entityType: 'HomepageSlide',
      entityId: slide.id,
      metadata: { mimeType: slide.mimeType, fileSize: slide.fileSize },
    });

    return slide;
  }

  /** Admin-facing: every slide for this store, active or not, most recently added first. */
  async findAllForAdmin(storeId: string) {
    return this.prisma.homepageSlide.findMany({ where: { storeId }, orderBy: { sortOrder: 'asc' } });
  }

  /** Storefront-facing: only active slides, in display order - never leaks a disabled/draft slide. */
  async findActiveForStorefront(storeId: string) {
    return this.prisma.homepageSlide.findMany({
      where: { storeId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, imageUrl: true, title: true, subtitle: true, linkUrl: true },
    });
  }

  async update(storeId: string, slideId: string, dto: UpdateHomepageSlideDto, actor: AuthenticatedUser) {
    const existing = await this.getScopedSlideOrThrow(storeId, slideId);

    const updated = await this.prisma.homepageSlide.update({
      where: { id: existing.id },
      data: {
        title: dto.title !== undefined ? dto.title : existing.title,
        subtitle: dto.subtitle !== undefined ? dto.subtitle : existing.subtitle,
        linkUrl: dto.linkUrl !== undefined ? dto.linkUrl : existing.linkUrl,
        isActive: dto.isActive !== undefined ? dto.isActive : existing.isActive,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'HomepageSlideUpdated',
      entityType: 'HomepageSlide',
      entityId: updated.id,
      metadata: { before: existing, after: updated },
    });

    return updated;
  }

  async reorder(storeId: string, dto: ReorderItemsDto, actor: AuthenticatedUser) {
    const ids = dto.items.map((item) => item.id);
    const owned = await this.prisma.homepageSlide.findMany({ where: { id: { in: ids }, storeId }, select: { id: true } });
    if (owned.length !== ids.length) {
      throw new NotFoundException('One or more slides were not found for this store');
    }

    await this.prisma.$transaction(
      dto.items.map((item) => this.prisma.homepageSlide.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } })),
    );

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'HomepageSlideReordered',
      entityType: 'HomepageSlide',
      metadata: { items: dto.items },
    });

    return { updated: dto.items.length };
  }

  async remove(storeId: string, slideId: string, actor: AuthenticatedUser) {
    const existing = await this.getScopedSlideOrThrow(storeId, slideId);

    // DB row is removed first; the storage object is best-effort cleanup
    // after (see MediaUploadService.safeDelete) - a failure there leaves an
    // orphaned file, never a DB row pointing at a file that's already gone.
    await this.prisma.homepageSlide.delete({ where: { id: existing.id } });
    if (existing.storageKey) await this.mediaUpload.safeDelete(existing.storageKey);

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'HomepageSlideDeleted',
      entityType: 'HomepageSlide',
      entityId: existing.id,
      metadata: { before: existing },
    });

    return { id: existing.id };
  }

  private async getScopedSlideOrThrow(storeId: string, slideId: string) {
    const slide = await this.prisma.homepageSlide.findFirst({ where: { id: slideId, storeId } });
    if (!slide) {
      throw new NotFoundException('Slide not found');
    }
    return slide;
  }
}
