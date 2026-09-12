import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateReviewDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  // Required (§5/§7 of this implementation's design) - every review in this
  // system is tied to a real, owned, DELIVERED OrderItem; there is no path
  // to an "unverified" review. See ReviewsService's own doc comment.
  @IsUUID()
  orderItemId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(150)
  title?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}
