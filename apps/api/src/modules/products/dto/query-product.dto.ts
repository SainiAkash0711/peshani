import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { ProductStatus, ProductType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const SORT_FIELDS = ['name', 'createdAt', 'updatedAt', 'status', 'basePrice', 'sku'] as const;

export class QueryProductDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: (typeof SORT_FIELDS)[number] = 'createdAt';
}
