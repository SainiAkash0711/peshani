import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AppConfig } from '../../config/configuration';
import { STORAGE_PROVIDER } from '../storage/storage.tokens';
import { StorageProvider } from '../storage/storage-provider.interface';

type ImageFormat = 'jpeg' | 'png' | 'webp';

export interface ValidatedUpload {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
  size: number;
  contentHash: string;
}

/**
 * Every uploaded file is untrusted input. This validates it independent of
 * whatever the client claimed (filename, extension, Content-Type) by
 * checking magic bytes AND fully decoding it with sharp - a file only
 * passes if all of size/MIME-allowlist/magic-bytes/decoded-format agree.
 * Shared by ProductImagesService and VariantImagesService so the same
 * scrutiny applies to both, once.
 */
@Injectable()
export class MediaUploadService {
  private readonly logger = new Logger(MediaUploadService.name);

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async validate(file: Express.Multer.File | undefined): Promise<ValidatedUpload> {
    const mediaConfig = this.configService.get('media', { infer: true });

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('No file was uploaded');
    }
    if (file.size > mediaConfig.maxUploadBytes) {
      throw new BadRequestException(
        `File exceeds the maximum allowed size of ${Math.floor(mediaConfig.maxUploadBytes / (1024 * 1024))} MB`,
      );
    }
    // multer's reported mimetype is a client-supplied hint - checked here only
    // as a first filter, never trusted on its own (see the decode check below).
    if (!mediaConfig.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
    }

    const magicFormat = this.detectMagicBytes(file.buffer);
    if (!magicFormat) {
      throw new BadRequestException('The file does not have a recognized image signature');
    }

    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(file.buffer).metadata();
    } catch {
      throw new BadRequestException('The file could not be decoded as a valid image');
    }

    const decodedFormat = metadata.format;
    const isSupportedFormat = decodedFormat === 'jpeg' || decodedFormat === 'png' || decodedFormat === 'webp';
    if (!isSupportedFormat || decodedFormat !== magicFormat) {
      throw new BadRequestException('The file content does not match a supported image format');
    }
    // The client's claimed Content-Type must also agree with what the file
    // actually decodes to - otherwise a real JPEG could sail through wearing
    // a claimed "image/png" label (both individually pass the allowlist) and
    // nothing would have cross-checked the two against each other.
    if (file.mimetype !== `image/${decodedFormat}`) {
      throw new BadRequestException('The declared file type does not match the actual file content');
    }
    if (!metadata.width || !metadata.height) {
      throw new BadRequestException('Could not determine image dimensions');
    }

    return {
      buffer: file.buffer,
      mimeType: `image/${decodedFormat}`,
      // Extension comes from the server-validated decoded format, never the
      // client's filename - this makes extension-spoofing structurally
      // impossible rather than merely detected.
      extension: decodedFormat === 'jpeg' ? '.jpg' : `.${decodedFormat}`,
      width: metadata.width,
      height: metadata.height,
      size: file.buffer.length,
      contentHash: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }

  async upload(key: string, validated: ValidatedUpload) {
    return this.storage.upload({ key, buffer: validated.buffer, contentType: validated.mimeType });
  }

  /**
   * DB row is deleted first by the caller; this is best-effort cleanup of the
   * now-orphaned storage object. A failure here is logged, not thrown - the
   * DB is already the authoritative "this image is gone" state, and a
   * lingering file is a disk-space cleanup concern, not a correctness one.
   */
  async safeDelete(key: string | null | undefined): Promise<void> {
    if (!key) return;
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(`Failed to delete storage object "${key}": ${error}`);
    }
  }

  getUrl(key: string): string {
    return this.storage.getUrl(key);
  }

  private detectMagicBytes(buffer: Buffer): ImageFormat | null {
    if (buffer.length < 12) return null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return 'png';
    }
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    return null;
  }
}
