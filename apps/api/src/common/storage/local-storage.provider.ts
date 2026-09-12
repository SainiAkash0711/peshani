import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { AppConfig } from '../../config/configuration';
import { StorageProvider, StorageUploadInput, StorageUploadResult } from './storage-provider.interface';

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  private readonly root: string;
  private readonly publicBaseUrl: string;

  constructor(configService: ConfigService<AppConfig, true>) {
    const storageConfig = configService.get('storage', { infer: true });
    this.root = resolve(storageConfig.localRoot);
    this.publicBaseUrl = storageConfig.publicBaseUrl.replace(/\/$/, '');
  }

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    const destination = this.resolveSafePath(input.key);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, input.buffer);
    return { key: input.key, url: this.getUrl(input.key), size: input.buffer.length };
  }

  async delete(key: string): Promise<void> {
    const target = this.resolveSafePath(key);
    await rm(target, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.resolveSafePath(key));
  }

  getUrl(key: string): string {
    const safeSegments = key.split('/').map((segment) => encodeURIComponent(segment));
    return `${this.publicBaseUrl}/media/${safeSegments.join('/')}`;
  }

  /**
   * The key is always server-generated (see MediaUploadService), so this is
   * defense-in-depth rather than the primary safeguard: it resolves the
   * final path and refuses to write outside the configured storage root,
   * which is what actually stops "../" (or an absolute path) from escaping
   * the intended directory even if a key were ever constructed incorrectly.
   */
  private resolveSafePath(key: string): string {
    const resolved = resolve(join(this.root, key));
    if (resolved !== this.root && !resolved.startsWith(this.root + sep)) {
      throw new InternalServerErrorException('Invalid storage key');
    }
    return resolved;
  }
}
