export interface CheckoutSession {
  orderNumber: string;
  razorpayOrderId: string;
  razorpayKeyId: string;
  amount: string;
  currency: string;
  customerEmail?: string;
}

export interface OrderItem {
  id: string;
  productId: string | null;
  variantId: string | null;
  name: string;
  variantName: string | null;
  sku: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  image: string | null;
}

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'PACKED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

export interface OrderStatusTimelineEntry {
  status: string;
  at: string;
}

export interface OrderSummary {
  orderNumber: string;
  status: OrderStatus;
  currency: string;
  totalAmount: string;
  createdAt: string;
}

export interface OrderDetail {
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: string | null;
  currency: string;
  subtotal: string;
  taxAmount: string;
  shippingAmount: string;
  discountAmount: string;
  couponCode: string | null;
  promotionName: string | null;
  totalAmount: string;
  customerEmail: string;
  customerPhone: string | null;
  billingAddress: Record<string, string>;
  shippingAddress: Record<string, string>;
  shippingMethodName?: string | null;
  placedAt: string;
  statusTimeline: OrderStatusTimelineEntry[];
  confirmedAt: string | null;
  items: OrderItem[];
}
