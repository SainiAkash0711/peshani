import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { IsSlug } from '../../../common/validators/slug.validator';

export class UpdateBrandDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @IsSlug()
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logo?: string;

  @IsOptional()
  @IsUrl({}, { message: 'website must be a valid URL' })
  @MaxLength(500)
  website?: string;

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
  isActive?: boolean;
}
