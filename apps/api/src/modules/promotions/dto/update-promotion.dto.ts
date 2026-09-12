import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/decimal.validator';

const DISCOUNT_TYPES = ['PERCENTAGE', 'FIXED_AMOUNT'] as const;

export class UpdatePromotionDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsIn(DISCOUNT_TYPES)
  discountType?: (typeof DISCOUNT_TYPES)[number];

  @IsOptional()
  @IsMoneyString()
  value?: string;

  @IsOptional()
  @IsMoneyString()
  maximumDiscountAmount?: string;

  @IsOptional()
  @IsMoneyString()
  minimumOrderAmount?: string;

  @IsOptional()
  @Type(() => Number)
  sortOrder?: number;

  // Same semantics as CreatePromotionDto - when provided (even as an empty
  // array), REPLACES the full set of targets/exclusions for that dimension.
  // Omitting a field entirely leaves that dimension's existing rows untouched.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  productIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  excludedProductIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  excludedCategoryIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  brandIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  excludedBrandIds?: string[];
}
