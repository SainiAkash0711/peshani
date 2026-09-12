import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { NotificationChannel, NotificationType } from '@prisma/client';

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

export class CreateNotificationTemplateDto {
  @IsIn(NOTIFICATION_TYPES)
  key!: NotificationType;

  @IsIn(NOTIFICATION_CHANNELS)
  channel!: NotificationChannel;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsString()
  @MaxLength(5000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
