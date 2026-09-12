import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ProductStatus, ProductType } from '@prisma/client';
import { IsSlug } from '../../../common/validators/slug.validator';
import { IsMoneyString, IsWeightString } from '../../../common/validators/decimal.validator';

export class CreateProductDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @IsSlug()
  slug?: string;

  @IsOptional()
  @IsEnum(ProductType)
  productType?: ProductType;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  shortDescription?: string;

  // Only meaningful for SIMPLE products - see ProductsService for the rule.
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(64)
  sku?: string;

  @IsMoneyString()
  basePrice!: string;

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

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsUUID()
  brandId?: string;

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

  // Which attributes act as this product's variant axes (VARIABLE products only).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  attributeIds?: string[];
}
