import { IsBoolean } from 'class-validator';

export class UpdatePromotionStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
