export type NotificationType =
  | 'ORDER_CONFIRMED'
  | 'ORDER_CANCELLED'
  | 'ORDER_PACKED'
  | 'ORDER_SHIPPED'
  | 'ORDER_DELIVERED'
  | 'PAYMENT_SUCCESS'
  | 'PAYMENT_FAILED'
  | 'REVIEW_APPROVED'
  | 'REVIEW_REJECTED'
  | 'PROMOTION_AVAILABLE'
  | 'COUPON_AVAILABLE';

export type NotificationChannel = 'IN_APP' | 'EMAIL';

export interface Notification {
  id: string;
  storeId: string;
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  status: string;
  readAt: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationListResponse {
  items: Notification[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UnreadCountResponse {
  count: number;
}

export type NotificationPreferenceKey =
  | 'EMAIL_ORDER_UPDATES'
  | 'EMAIL_PAYMENT_UPDATES'
  | 'EMAIL_SHIPPING_UPDATES'
  | 'EMAIL_REVIEW_UPDATES'
  | 'EMAIL_PROMOTION_UPDATES'
  | 'IN_APP_ORDER_UPDATES'
  | 'IN_APP_PAYMENT_UPDATES'
  | 'IN_APP_SHIPPING_UPDATES'
  | 'IN_APP_REVIEW_UPDATES'
  | 'IN_APP_PROMOTION_UPDATES';

export type NotificationPreferences = Record<NotificationPreferenceKey, boolean>;
