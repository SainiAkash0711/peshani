import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ProductVariantStatus } from '@prisma/client';
import { IsMoneyString, IsWeightString } from '../../../common/validators/decimal.validator';

export class UpdateVariantDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(64)
  sku?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(64)
  barcode?: string;

  @IsOptional()
  @IsMoneyString()
  price?: string;

  @IsOptional()
  @IsMoneyString()
  compareAtPrice?: string;

  @IsOptional()
  @IsMoneyString()
  costPrice?: string;

  @IsOptional()
  @IsWeightString()
  weight?: string;

  @IsOptional()
  @IsEnum(ProductVariantStatus)
  status?: ProductVariantStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  image?: string;

  // Changing the combination re-validates uniqueness and recomputes combinationKey.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  attributeValueIds?: string[];
}
