import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsSlug } from '../../../common/validators/slug.validator';
import { IsMoneyString, IsWeightString } from '../../../common/validators/decimal.validator';

// productType is deliberately absent - immutable after creation (see ProductsService).
// status is changed only via PATCH /:id/status, matching the Category/Brand/Attribute pattern.
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @IsSlug()
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  shortDescription?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(64)
  sku?: string;

  @IsOptional()
  @IsMoneyString()
  basePrice?: string;

  @IsOptional()
  @IsMoneyString()
  compareAtPrice?: string;

  @IsOptional()
  @IsMoneyString()
  costPrice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  taxClass?: string;

  @IsOptional()
  @IsWeightString()
  weight?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  seoDescription?: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsBoolean()
  isBestseller?: boolean;

  @IsOptional()
  @IsBoolean()
  isNewArrival?: boolean;

  // Explicit null clears the brand. Omitted -> unchanged.
  @IsOptional()
  @IsUUID()
  brandId?: string | null;

  // Present (even []) -> replaces the full set. Omitted -> unchanged.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tagNames?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  attributeIds?: string[];
}
