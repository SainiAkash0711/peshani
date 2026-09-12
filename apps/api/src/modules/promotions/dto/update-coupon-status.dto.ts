import { IsBoolean } from 'class-validator';

export class UpdateCouponStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
