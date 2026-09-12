import { IsString, MaxLength, MinLength } from 'class-validator';

export class ValidateCouponDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  couponCode!: string;
}
