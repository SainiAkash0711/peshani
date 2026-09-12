import { IsEnum } from 'class-validator';
import { ProductStatus } from '@prisma/client';

export class UpdateProductStatusDto {
  @IsEnum(ProductStatus)
  status!: ProductStatus;
}
