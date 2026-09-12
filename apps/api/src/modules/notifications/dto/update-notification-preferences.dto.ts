import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  EMAIL_ORDER_UPDATES?: boolean;

  @IsOptional()
  @IsBoolean()
  EMAIL_PAYMENT_UPDATES?: boolean;

  @IsOptional()
  @IsBoolean()
  EMAIL_SHIPPING_UPDATES?: boolean;

  @IsOptional()
  @IsBoolean()
  EMAIL_REVIEW_UPDATES?: boolean;

  @IsOptional()
  @IsBoolean()
  EMAIL_PROMOTION_UPDATES?: boolean;

  @IsOptional()
  @IsBoolean()
  IN_APP_ORDER_UPDATES?: boolean;

  @IsOptional()
  @IsBoolean()
  IN_APP_PAYMENT_UPDATES?: boolean;

  @IsOptional()
  @IsBoolean()
  IN_APP_SHIPPING_UPDATES?: boolean;

  @IsOptional()
  @IsBoolean()
  IN_APP_REVIEW_UPDATES?: boolean;

  @IsOptional()
  @IsBoolean()
  IN_APP_PROMOTION_UPDATES?: boolean;
}
