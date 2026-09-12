import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateHomepageSlideDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  subtitle?: string;

  // Allows a relative in-app path (e.g. /products/some-slug) as well as a
  // full URL, since most slides link within this same storefront.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  linkUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
