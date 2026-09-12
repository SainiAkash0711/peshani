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

export type NotificationDeliveryStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';

export interface NotificationUserRef {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export interface AdminNotification {
  id: string;
  storeId: string;
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  status: NotificationDeliveryStatus;
  idempotencyKey: string | null;
  readAt: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  user: NotificationUserRef;
}

// The /admin/notifications endpoint returns a flat pagination shape
// ({ items, total, page, pageSize }), not the { items, pagination: {...} }
// shape used by most other admin list endpoints - keep this separate from
// the shared PaginatedResult<T> type in types/catalog.ts.
export interface AdminNotificationsListResult {
  items: AdminNotification[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NotificationTemplate {
  id: string;
  storeId: string;
  key: NotificationType;
  channel: NotificationChannel;
  subject: string | null;
  title: string | null;
  body: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface NotificationTemplateCreateValues {
  key: NotificationType;
  channel: NotificationChannel;
  subject?: string;
  title?: string;
  body: string;
  isActive?: boolean;
}

export interface NotificationTemplateUpdateValues {
  subject?: string;
  title?: string;
  body?: string;
}
