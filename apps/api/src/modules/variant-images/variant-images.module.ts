import { Module } from '@nestjs/common';
import { VariantImagesService } from './variant-images.service';
import { VariantImagesController } from './variant-images.controller';

@Module({
  controllers: [VariantImagesController],
  providers: [VariantImagesService],
  exports: [VariantImagesService],
})
export class VariantImagesModule {}
