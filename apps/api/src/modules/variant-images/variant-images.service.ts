import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MediaUploadService } from '../../common/media/media-upload.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { UpdateVariantImageDto } from './dto/update-variant-image.dto';
import { ReorderItemsDto } from '../../common/dto/reorder-items.dto';

// Unlike a product, a variant with zero images is a valid, intentional state
// (the storefront falls back to the parent product's own images - see
// ProductDetailInteractive's `images` memo) so only the upper bound is
// enforced here, matching ProductImagesService's cap for gallery usability.
const MAX_VARIANT_IMAGES = 5;

@Injectable()
export class VariantImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly mediaUpload: MediaUploadService,
  ) {}

  async upload(
    storeId: string,
    productId: string,
    variantId: string,
    file: Express.Multer.File | undefined,
    dto: UpdateVariantImageDto,
    actor: AuthenticatedUser,
  ) {
    await this.getStoreScopedVariantOrThrow(storeId, productId, variantId);

    const existingCount = await this.prisma.variantImage.count({ where: { variantId } });
    if (existingCount >= MAX_VARIANT_IMAGES) {
      throw new ConflictException(
        `This variant already has the maximum of ${MAX_VARIANT_IMAGES} images. Delete one before adding another.`,
      );
    }

    const validated = await this.mediaUpload.validate(file);

    const key = `stores/${storeId}/products/${productId}/variants/${variantId}/${randomUUID()}${validated.extension}`;
    const uploadResult = await this.mediaUpload.upload(key, validated);

    const image = await this.prisma.variantImage.create({
      data: {
        storeId,
        variantId,
        url: uploadResult.url,
        storageKey: key,
        originalFilename: file!.originalname?.slice(0, 255),
        mimeType: validated.mimeType,
        fileSize: validated.size,
        width: validated.width,
        height: validated.height,
        contentHash: validated.contentHash,
        altText: dto.altText,
        caption: dto.caption,
        sortOrder: existingCount,
        isPrimary: existingCount === 0,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'VariantImageUploaded',
      entityType: 'VariantImage',
      entityId: image.id,
      metadata: { productId, variantId, mimeType: image.mimeType, fileSize: image.fileSize },
    });

    return image;
  }

  async findAll(storeId: string, productId: string, variantId: string) {
    await this.getStoreScopedVariantOrThrow(storeId, productId, variantId);
    return this.prisma.variantImage.findMany({
      where: { variantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async update(
    storeId: string,
    productId: string,
    variantId: string,
    imageId: string,
    dto: UpdateVariantImageDto,
    actor: AuthenticatedUser,
  ) {
    await this.getStoreScopedVariantOrThrow(storeId, productId, variantId);
    const existing = await this.getScopedImageOrThrow(variantId, imageId);

    const updated = await this.prisma.variantImage.update({
      where: { id: existing.id },
      data: {
        altText: dto.altText !== undefined ? dto.altText : existing.altText,
        caption: dto.caption !== undefined ? dto.caption : existing.caption,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'VariantImageUpdated',
      entityType: 'VariantImage',
      entityId: updated.id,
      metadata: { before: existing, after: updated, productId, variantId },
    });

    return updated;
  }

  async setPrimary(storeId: string, productId: string, variantId: string, imageId: string, actor: AuthenticatedUser) {
    await this.getStoreScopedVariantOrThrow(storeId, productId, variantId);
    await this.getScopedImageOrThrow(variantId, imageId);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.variantImage.updateMany({ where: { variantId, isPrimary: true }, data: { isPrimary: false } });
      return tx.variantImage.update({ where: { id: imageId }, data: { isPrimary: true } });
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'VariantPrimaryImageChanged',
      entityType: 'VariantImage',
      entityId: updated.id,
      metadata: { productId, variantId },
    });

    return updated;
  }

  async reorder(storeId: string, productId: string, variantId: string, dto: ReorderItemsDto, actor: AuthenticatedUser) {
    await this.getStoreScopedVariantOrThrow(storeId, productId, variantId);

    const ids = dto.items.map((item) => item.id);
    const owned = await this.prisma.variantImage.findMany({
      where: { id: { in: ids }, variantId },
      select: { id: true },
    });
    if (owned.length !== ids.length) {
      throw new NotFoundException('One or more images were not found for this variant');
    }

    await this.prisma.$transaction(
      dto.items.map((item) => this.prisma.variantImage.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } })),
    );

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'VariantImageReordered',
      entityType: 'VariantImage',
      metadata: { productId, variantId, items: dto.items },
    });

    return { updated: dto.items.length };
  }

  async remove(storeId: string, productId: string, variantId: string, imageId: string, actor: AuthenticatedUser) {
    await this.getStoreScopedVariantOrThrow(storeId, productId, variantId);
    const existing = await this.getScopedImageOrThrow(variantId, imageId);

    await this.prisma.variantImage.delete({ where: { id: existing.id } });
    await this.mediaUpload.safeDelete(existing.storageKey);

    if (existing.isPrimary) {
      const next = await this.prisma.variantImage.findFirst({ where: { variantId }, orderBy: { sortOrder: 'asc' } });
      if (next) {
        await this.prisma.variantImage.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    }

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'VariantImageDeleted',
      entityType: 'VariantImage',
      entityId: existing.id,
      metadata: { productId, variantId, before: existing },
    });

    return { id: existing.id };
  }

  /** Verifies the full chain: variant belongs to product, product belongs to store. */
  private async getStoreScopedVariantOrThrow(storeId: string, productId: string, variantId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, storeId, deletedAt: null } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    const variant = await this.prisma.productVariant.findFirst({ where: { id: variantId, productId, deletedAt: null } });
    if (!variant) {
      throw new NotFoundException('Variant not found');
    }
    return variant;
  }

  private async getScopedImageOrThrow(variantId: string, imageId: string) {
    const image = await this.prisma.variantImage.findFirst({ where: { id: imageId, variantId } });
    if (!image) {
      throw new NotFoundException('Image not found');
    }
    return image;
  }
}
