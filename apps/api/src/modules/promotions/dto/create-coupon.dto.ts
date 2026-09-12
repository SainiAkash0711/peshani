import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';

export class CreateCouponDto {
  @IsUUID()
  promotionId!: string;

  // Normalized (trimmed + uppercased) in CouponsService before storage/
  // lookup - the client may type any case, see the Coupon model's own doc
  // comment (§9). Letters/digits/hyphen/underscore only, matching the
  // conventional shape of a promo code.
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'code may only contain letters, digits, hyphens and underscores' })
  code!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perCustomerUsageLimit?: number;
}
