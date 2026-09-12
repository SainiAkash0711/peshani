import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/decimal.validator';

const DISCOUNT_TYPES = ['PERCENTAGE', 'FIXED_AMOUNT'] as const;

export class CreatePromotionDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsIn(DISCOUNT_TYPES)
  discountType!: (typeof DISCOUNT_TYPES)[number];

  // A decimal string - for PERCENTAGE, 0 < value <= 100; for FIXED_AMOUNT,
  // value > 0. Both are business rules enforced in PromotionsService (the
  // valid range depends on discountType, which a plain decorator here can't
  // express), never trusted from the client either way.
  @IsMoneyString()
  value!: string;

  @IsOptional()
  @IsMoneyString()
  maximumDiscountAmount?: string;

  @IsOptional()
  @IsMoneyString()
  minimumOrderAmount?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  sortOrder?: number;

  // Targeting (§11-§14): omit entirely (or send empty arrays) for a
  // store-wide promotion. Any include list narrows eligibility; any exclude
  // list removes matching items regardless of inclusion (exclusion always
  // wins). A product/category/brand id may appear in at most one of a
  // dimension's two lists - PromotionsService rejects overlap explicitly.
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
