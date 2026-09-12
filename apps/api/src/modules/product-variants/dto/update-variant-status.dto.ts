import { IsEnum } from 'class-validator';
import { ProductVariantStatus } from '@prisma/client';

export class UpdateVariantStatusDto {
  @IsEnum(ProductVariantStatus)
  status!: ProductVariantStatus;
}
