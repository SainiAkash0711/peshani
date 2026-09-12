export interface StorageUploadInput {
  /** Server-generated key - never derived from client input. See MediaUploadService. */
  key: string;
  buffer: Buffer;
  contentType: string;
}

export interface StorageUploadResult {
  key: string;
  url: string;
  size: number;
}

/**
 * Abstraction over "where uploaded files physically live." Business logic
 * (ProductImagesService, VariantImagesService) depends only on this
 * interface, never on filesystem or S3 APIs directly - swapping
 * STORAGE_PROVIDER=local for an S3-compatible implementation later means
 * writing one new class, not touching any media business logic.
 */
export interface StorageProvider {
  upload(input: StorageUploadInput): Promise<StorageUploadResult>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getUrl(key: string): string;
}
