import { Global, Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { MediaUploadService } from './media-upload.service';

@Global()
@Module({
  imports: [StorageModule],
  providers: [MediaUploadService],
  exports: [MediaUploadService],
})
export class MediaModule {}
