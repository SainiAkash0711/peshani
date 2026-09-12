import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProductImageDto {
  @IsOptional()
  @IsString()
  @MaxLength(250)
  altText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;
}
