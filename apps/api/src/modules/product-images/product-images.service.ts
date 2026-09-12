import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MediaUploadService } from '../../common/media/media-upload.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { UpdateProductImageDto } from './dto/update-product-image.dto';
import { ReorderItemsDto } from '../../common/dto/reorder-items.dto';

// A product's gallery must never be empty (storefront always needs at least
// one photo to show) and is capped so the admin gallery/storefront thumbnail
// strip stays usable - enforced here, not just in the admin UI, since a
// direct API call must not be able to bypass either rule.
const MIN_PRODUCT_IMAGES = 1;
const MAX_PRODUCT_IMAGES = 5;

@Injectable()
export class ProductImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly mediaUpload: MediaUploadService,
  ) {}

  async upload(
    storeId: string,
    productId: string,
    file: Express.Multer.File | undefined,
    dto: UpdateProductImageDto,
    actor: AuthenticatedUser,
  ) {
    await this.getStoreScopedProductOrThrow(storeId, productId);

    const existingCount = await this.prisma.productImage.count({ where: { productId } });
    if (existingCount >= MAX_PRODUCT_IMAGES) {
      throw new ConflictException(
        `This product already has the maximum of ${MAX_PRODUCT_IMAGES} images. Delete one before adding another.`,
      );
    }

    const validated = await this.mediaUpload.validate(file);

    const key = `stores/${storeId}/products/${productId}/${randomUUID()}${validated.extension}`;
    const uploadResult = await this.mediaUpload.upload(key, validated);

    const image = await this.prisma.productImage.create({
      data: {
        storeId,
        productId,
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
        // The first image for a product automatically becomes primary - there
        // is no meaningful "no primary image" state for a product with photos.
        isPrimary: existingCount === 0,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'ProductImageUploaded',
      entityType: 'ProductImage',
      entityId: image.id,
      metadata: { productId, mimeType: image.mimeType, fileSize: image.fileSize },
    });

    return image;
  }

  async findAll(storeId: string, productId: string) {
    await this.getStoreScopedProductOrThrow(storeId, productId);
    return this.prisma.productImage.findMany({
      where: { productId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async update(storeId: string, productId: string, imageId: string, dto: UpdateProductImageDto, actor: AuthenticatedUser) {
    await this.getStoreScopedProductOrThrow(storeId, productId);
    const existing = await this.getScopedImageOrThrow(productId, imageId);

    const updated = await this.prisma.productImage.update({
      where: { id: existing.id },
      data: {
        altText: dto.altText !== undefined ? dto.altText : existing.altText,
        caption: dto.caption !== undefined ? dto.caption : existing.caption,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'ProductImageUpdated',
      entityType: 'ProductImage',
      entityId: updated.id,
      metadata: { before: existing, after: updated, productId },
    });

    return updated;
  }

  async setPrimary(storeId: string, productId: string, imageId: string, actor: AuthenticatedUser) {
    await this.getStoreScopedProductOrThrow(storeId, productId);
    await this.getScopedImageOrThrow(productId, imageId);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.productImage.updateMany({ where: { productId, isPrimary: true }, data: { isPrimary: false } });
      return tx.productImage.update({ where: { id: imageId }, data: { isPrimary: true } });
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'ProductPrimaryImageChanged',
      entityType: 'ProductImage',
      entityId: updated.id,
      metadata: { productId },
    });

    return updated;
  }

  async reorder(storeId: string, productId: string, dto: ReorderItemsDto, actor: AuthenticatedUser) {
    await this.getStoreScopedProductOrThrow(storeId, productId);

    const ids = dto.items.map((item) => item.id);
    const owned = await this.prisma.productImage.findMany({
      where: { id: { in: ids }, productId },
      select: { id: true },
    });
    if (owned.length !== ids.length) {
      throw new NotFoundException('One or more images were not found for this product');
    }

    await this.prisma.$transaction(
      dto.items.map((item) => this.prisma.productImage.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } })),
    );

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'ProductImageReordered',
      entityType: 'ProductImage',
      metadata: { productId, items: dto.items },
    });

    return { updated: dto.items.length };
  }

  async remove(storeId: string, productId: string, imageId: string, actor: AuthenticatedUser) {
    await this.getStoreScopedProductOrThrow(storeId, productId);
    const existing = await this.getScopedImageOrThrow(productId, imageId);

    const existingCount = await this.prisma.productImage.count({ where: { productId } });
    if (existingCount <= MIN_PRODUCT_IMAGES) {
      throw new ConflictException(
        `Cannot delete this image: a product must have at least ${MIN_PRODUCT_IMAGES} image. Upload a replacement first.`,
      );
    }

    // DB row is removed first; the storage object is best-effort cleanup
    // after (see MediaUploadService.safeDelete) - a failure there leaves an
    // orphaned file, never a DB row pointing at a file that's already gone.
    await this.prisma.productImage.delete({ where: { id: existing.id } });
    await this.mediaUpload.safeDelete(existing.storageKey);

    if (existing.isPrimary) {
      const next = await this.prisma.productImage.findFirst({ where: { productId }, orderBy: { sortOrder: 'asc' } });
      if (next) {
        await this.prisma.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    }

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'ProductImageDeleted',
      entityType: 'ProductImage',
      entityId: existing.id,
      metadata: { productId, before: existing },
    });

    return { id: existing.id };
  }

  private async getStoreScopedProductOrThrow(storeId: string, productId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, storeId, deletedAt: null } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  private async getScopedImageOrThrow(productId: string, imageId: string) {
    const image = await this.prisma.productImage.findFirst({ where: { id: imageId, productId } });
    if (!image) {
      throw new NotFoundException('Image not found');
    }
    return image;
  }
}
