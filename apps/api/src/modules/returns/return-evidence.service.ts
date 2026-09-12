import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaUploadService } from '../../common/media/media-upload.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';

/**
 * §16/§17 - reuses MediaUploadService (magic-byte + sharp-decode validation,
 * SHA-256, size/MIME limits - identical scrutiny to product/variant images,
 * no second upload mechanism) and the existing StorageProvider abstraction.
 * Storage keys are server-generated (randomUUID, never a client filename) -
 * the same unguessable-key access model already used for every other
 * uploaded image in this codebase (product/variant images); the actual
 * access-control boundary that matters is at the application layer: only
 * this return's own owning customer (customer routes) or an admin of the
 * SAME store (admin routes) is ever handed the evidence's id/url at all -
 * see ReturnRequestService.findOneForCustomer/AdminReturnsController.
 */
@Injectable()
export class ReturnEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaUpload: MediaUploadService,
  ) {}

  async upload(storeId: string, actor: AuthenticatedUser, returnRequestId: string, file: Express.Multer.File | undefined) {
    const returnRequest = await this.prisma.returnRequest.findFirst({ where: { id: returnRequestId, storeId, userId: actor.userId } });
    if (!returnRequest) {
      throw new NotFoundException('Return request not found');
    }

    const validated = await this.mediaUpload.validate(file);
    const key = `stores/${storeId}/returns/${returnRequestId}/${randomUUID()}${validated.extension}`;
    const uploadResult = await this.mediaUpload.upload(key, validated);

    return this.prisma.returnEvidence.create({
      data: {
        storeId,
        returnRequestId,
        url: uploadResult.url,
        storageKey: key,
        originalFilename: file!.originalname?.slice(0, 255),
        mimeType: validated.mimeType,
        fileSize: validated.size,
        contentHash: validated.contentHash,
        uploadedByUserId: actor.userId,
      },
    });
  }
}
