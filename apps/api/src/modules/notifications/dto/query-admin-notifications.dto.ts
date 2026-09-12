import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { NotificationChannel, NotificationStatus, NotificationType } from '@prisma/client';

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
const NOTIFICATION_CHANNELS: NotificationChannel[] = ['IN_APP', 'EMAIL'];
const NOTIFICATION_STATUSES: NotificationStatus[] = ['PENDING', 'PROCESSING', 'SENT', 'FAILED'];

export class QueryAdminNotificationsDto {
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
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsIn(NOTIFICATION_CHANNELS)
  channel?: NotificationChannel;

  @IsOptional()
  @IsIn(NOTIFICATION_TYPES)
  type?: NotificationType;

  @IsOptional()
  @IsIn(NOTIFICATION_STATUSES)
  status?: NotificationStatus;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;
}
