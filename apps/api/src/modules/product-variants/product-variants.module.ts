import { Module } from '@nestjs/common';
import { ProductVariantsService } from './product-variants.service';
import { ProductVariantsController } from './product-variants.controller';
import { VariantGeneratorService } from './variant-generator.service';

@Module({
  controllers: [ProductVariantsController],
  providers: [ProductVariantsService, VariantGeneratorService],
  exports: [ProductVariantsService, VariantGeneratorService],
})
export class ProductVariantsModule {}
