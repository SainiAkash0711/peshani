export interface ShippingMethod {
  id: string;
  storeId: string;
  name: string;
  code: string;
  description?: string | null;
  price: string;
  estimatedDeliveryDays?: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'PACKED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

export type PaymentStatus = 'CREATED' | 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'CANCELLED';

export interface OrderListItem {
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  currency: string;
  totalAmount: string;
  customerEmail: string;
  shippingMethodName?: string | null;
  createdAt: string;
}

export interface OrderAddress {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface OrderStatusTimelineEntry {
  status: string;
  at: string;
}

export interface OrderItemLine {
  productId: string;
  variantId?: string | null;
  name: string;
  sku: string;
  variantName?: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  image?: string | null;
}

export interface OrderPayment {
  id: string;
  provider: string;
  providerOrderId?: string | null;
  providerPaymentId?: string | null;
  status: string;
  amount: string;
  currency: string;
  failureReason?: string | null;
  paidAt?: string | null;
  createdAt: string;
}

export interface AdminOrderDetail {
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  currency: string;
  subtotal: string;
  taxAmount: string;
  shippingAmount: string;
  discountAmount: string;
  totalAmount: string;
  customerEmail: string;
  customerPhone?: string | null;
  billingAddress: OrderAddress;
  shippingAddress: OrderAddress;
  shippingMethodName?: string | null;
  placedAt: string;
  statusTimeline: OrderStatusTimelineEntry[];
  confirmedAt: string | null;
  items: OrderItemLine[];
  orderId: string;
  userId?: string | null;
  fulfilledAt?: string | null;
  shippingMethodId?: string | null;
  payments: OrderPayment[];
}
