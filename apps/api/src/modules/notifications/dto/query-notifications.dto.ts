import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { NotificationType } from '@prisma/client';

const NOTIFICATION_TYPES: NotificationType[] = [
  'ORDER_CONFIRMED',
  'ORDER_CANCELLED',
  'ORDER_PACKED',
  'ORDER_SHIPPED',
  'ORDER_DELIVERED',
  'PAYMENT_SUCCESS',
  'PAYMENT_FAILED',
  'REVIEW_APPROVED',
  'REVIEW_REJECTED',
  'PROMOTION_AVAILABLE',
  'COUPON_AVAILABLE',
];

export class QueryNotificationsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsIn(NOTIFICATION_TYPES)
  type?: NotificationType;
}
