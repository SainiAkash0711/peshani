import { NotificationChannel, NotificationDeliveryStatus, NotificationType } from '../types/notifications';

export const NOTIFICATION_TYPES: NotificationType[] = [
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

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  ORDER_CONFIRMED: 'Order Confirmed',
  ORDER_CANCELLED: 'Order Cancelled',
  ORDER_PACKED: 'Order Packed',
  ORDER_SHIPPED: 'Order Shipped',
  ORDER_DELIVERED: 'Order Delivered',
  PAYMENT_SUCCESS: 'Payment Success',
  PAYMENT_FAILED: 'Payment Failed',
  REVIEW_APPROVED: 'Review Approved',
  REVIEW_REJECTED: 'Review Rejected',
  PROMOTION_AVAILABLE: 'Promotion Available',
  COUPON_AVAILABLE: 'Coupon Available',
};

export const NOTIFICATION_CHANNELS: NotificationChannel[] = ['IN_APP', 'EMAIL'];

export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> = {
  IN_APP: 'In-App',
  EMAIL: 'Email',
};

export const NOTIFICATION_STATUSES: NotificationDeliveryStatus[] = ['PENDING', 'PROCESSING', 'SENT', 'FAILED'];

const ORDER_TYPES = new Set<NotificationType>([
  'ORDER_CONFIRMED',
  'ORDER_CANCELLED',
  'ORDER_PACKED',
  'ORDER_SHIPPED',
  'ORDER_DELIVERED',
]);
const PAYMENT_TYPES = new Set<NotificationType>(['PAYMENT_SUCCESS', 'PAYMENT_FAILED']);
const REVIEW_TYPES = new Set<NotificationType>(['REVIEW_APPROVED', 'REVIEW_REJECTED']);

/** Placeholder variable names that actually get substituted for a given notification type. */
export function placeholdersForType(type: NotificationType): string[] {
  if (ORDER_TYPES.has(type)) return ['customerName', 'orderNumber', 'orderTotal', 'shippingMethod'];
  if (PAYMENT_TYPES.has(type)) return ['customerName', 'orderNumber', 'orderTotal'];
  if (REVIEW_TYPES.has(type)) return ['productName'];
  if (type === 'PROMOTION_AVAILABLE') return ['promotionName'];
  if (type === 'COUPON_AVAILABLE') return ['couponCode'];
  return [];
}

const EXAMPLE_PLACEHOLDER_VALUES: Record<string, string> = {
  customerName: 'Jane Doe',
  orderNumber: 'PES-20260101-ABC123',
  orderTotal: '₹500.00',
  shippingMethod: 'Standard Shipping',
  productName: 'Wireless Headphones',
  promotionName: 'Festive Season Sale',
  couponCode: 'FEST25',
};

/**
 * Client-side ONLY preview substitution - not a call to any backend rendering
 * endpoint. Replaces the placeholders that are actually supported for this
 * notification type with small illustrative example values, and blanks out
 * any other {{...}} tokens to mirror the backend's behavior of rendering
 * unknown/missing variables as an empty string. Callers must render the
 * result as plain text (never via dangerouslySetInnerHTML) since it echoes
 * back whatever the admin typed in the body field.
 */
export function renderTemplatePreview(body: string, type: NotificationType): string {
  const supported = placeholdersForType(type);
  let result = body;
  for (const name of supported) {
    const value = EXAMPLE_PLACEHOLDER_VALUES[name] ?? '';
    result = result.split(`{{${name}}}`).join(value);
  }
  result = result.replace(/\{\{\s*[\w.]+\s*\}\}/g, '');
  return result;
}
