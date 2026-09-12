import { OrderStatus, PaymentStatus } from '../../types/orders';

const ORDER_STATUS_STYLES: Record<OrderStatus, { background: string; color: string; label: string }> = {
  PENDING_PAYMENT: { background: '#f3f4f6', color: '#6b7280', label: 'Pending Payment' },
  CONFIRMED: { background: '#e0f2fe', color: '#0369a1', label: 'Confirmed' },
  PROCESSING: { background: '#fef9c3', color: '#a16207', label: 'Processing' },
  PACKED: { background: '#ede9fe', color: '#6d28d9', label: 'Packed' },
  SHIPPED: { background: '#dbeafe', color: '#1d4ed8', label: 'Shipped' },
  DELIVERED: { background: '#dcfce7', color: '#15803d', label: 'Delivered' },
  CANCELLED: { background: '#fee2e2', color: '#dc2626', label: 'Cancelled' },
};

const PAYMENT_STATUS_STYLES: Record<PaymentStatus, { background: string; color: string; label: string }> = {
  CREATED: { background: '#f3f4f6', color: '#6b7280', label: 'Created' },
  PENDING: { background: '#fef9c3', color: '#a16207', label: 'Pending' },
  AUTHORIZED: { background: '#e0f2fe', color: '#0369a1', label: 'Authorized' },
  CAPTURED: { background: '#dcfce7', color: '#15803d', label: 'Captured' },
  FAILED: { background: '#fee2e2', color: '#dc2626', label: 'Failed' },
  CANCELLED: { background: '#fee2e2', color: '#dc2626', label: 'Cancelled' },
};

function Badge({ background, color, label }: { background: string; color: string; label: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background,
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const style = ORDER_STATUS_STYLES[status] ?? { background: '#f3f4f6', color: '#6b7280', label: status };
  return <Badge {...style} />;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const style = PAYMENT_STATUS_STYLES[status] ?? { background: '#f3f4f6', color: '#6b7280', label: status };
  return <Badge {...style} />;
}

export function formatOrderStatusLabel(status: string): string {
  return status
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}
