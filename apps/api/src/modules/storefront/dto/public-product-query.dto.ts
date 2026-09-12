import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const SORT_FIELDS = ['name', 'price', 'createdAt'] as const;

/**
 * Public product-listing query. Deliberately a much smaller whitelist than
 * the admin QueryProductDto - a storefront visitor filters by slug (never a
 * raw id), can't filter by internal status (ACTIVE is the only status ever
 * visible here), and sortBy is restricted to fields that make sense on a
 * public price/date, never anything admin-only like sku.
 */
export class PublicProductQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  categorySlug?: string;

  @IsOptional()
  @IsString()
  brandSlug?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  bestseller?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  newArrival?: boolean;

  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: (typeof SORT_FIELDS)[number] = 'createdAt';
}
