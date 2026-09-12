import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { TextAreaField } from '../../components/FormField';
import { cardStyle, pageHeaderStyle, tableStyle, tdStyle, thStyle } from '../../styles';
import { AdminOrderDetail, OrderStatus } from '../../types/orders';
import { OrderStatusBadge, PaymentStatusBadge, formatOrderStatusLabel } from './badges';

type ActionType = 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'FULFILL';

const ACTION_LABELS: Record<ActionType, string> = {
  PROCESSING: 'Start processing this order?',
  SHIPPED: 'Mark this order as shipped?',
  DELIVERED: 'Mark this order as delivered?',
  CANCELLED: 'Cancel this order? This cannot be undone.',
  FULFILL: 'Mark this order as packed and consume inventory?',
};

const ACTION_CONFIRM_LABELS: Record<ActionType, string> = {
  PROCESSING: 'Start Processing',
  SHIPPED: 'Mark Shipped',
  DELIVERED: 'Mark Delivered',
  CANCELLED: 'Cancel Order',
  FULFILL: 'Mark Packed',
};

function addressBlock(address: AdminOrderDetail['shippingAddress']) {
  return (
    <p style={{ margin: 0, fontSize: 14, color: '#374151', lineHeight: 1.6 }}>
      {address.fullName}
      <br />
      {address.phone}
      <br />
      {address.addressLine1}
      {address.addressLine2 ? `, ${address.addressLine2}` : ''}
      <br />
      {address.city}, {address.state} {address.postalCode}
      <br />
      {address.country}
    </p>
  );
}

export function OrderDetailPage() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [pendingAction, setPendingAction] = useState<ActionType | null>(null);
  const [reason, setReason] = useState('');

  const detailQuery = useQuery({
    queryKey: ['orders', 'detail', orderNumber],
    queryFn: () => apiClient.get<AdminOrderDetail>(`/admin/orders/${orderNumber}`),
    enabled: Boolean(orderNumber),
  });

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
  }

  const statusMutation = useMutation({
    mutationFn: ({ status, reason: r }: { status: OrderStatus; reason?: string }) =>
      apiClient.patch<AdminOrderDetail>(`/admin/orders/${orderNumber}/status`, { status, reason: r || undefined }),
    onSuccess: () => {
      toast.show('success', 'Order status updated');
      setPendingAction(null);
      setReason('');
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to update order status'),
  });

  const fulfillMutation = useMutation({
    mutationFn: (r?: string) => apiClient.post<AdminOrderDetail>(`/admin/orders/${orderNumber}/fulfill`, { reason: r || undefined }),
    onSuccess: () => {
      toast.show('success', 'Order marked as packed');
      setPendingAction(null);
      setReason('');
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to fulfill order'),
  });

  const isBusy = statusMutation.isPending || fulfillMutation.isPending;

  function runAction() {
    if (!pendingAction) return;
    if (pendingAction === 'FULFILL') {
      fulfillMutation.mutate(reason);
    } else {
      statusMutation.mutate({ status: pendingAction, reason });
    }
  }

  if (detailQuery.isLoading) {
    return <div style={{ padding: 24 }}>Loading order…</div>;
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div style={{ padding: 24 }}>
        <p style={{ color: '#dc2626' }}>Failed to load order.</p>
        <Button variant="secondary" onClick={() => navigate('/orders')}>
          Back to Orders
        </Button>
      </div>
    );
  }

  const order = detailQuery.data;

  const actionButtons: { type: ActionType; label: string; variant: 'primary' | 'danger' }[] = [];
  if (order.status === 'CONFIRMED') {
    actionButtons.push({ type: 'PROCESSING', label: 'Start Processing', variant: 'primary' });
    actionButtons.push({ type: 'CANCELLED', label: 'Cancel', variant: 'danger' });
  } else if (order.status === 'PROCESSING') {
    actionButtons.push({ type: 'FULFILL', label: 'Fulfill / Mark Packed', variant: 'primary' });
    actionButtons.push({ type: 'CANCELLED', label: 'Cancel', variant: 'danger' });
  } else if (order.status === 'PACKED') {
    actionButtons.push({ type: 'SHIPPED', label: 'Mark Shipped', variant: 'primary' });
  } else if (order.status === 'SHIPPED') {
    actionButtons.push({ type: 'DELIVERED', label: 'Mark Delivered', variant: 'primary' });
  }

  return (
    <div>
      <div style={pageHeaderStyle}>
        <div>
          <Button variant="secondary" onClick={() => navigate('/orders')} style={{ marginBottom: 10 }}>
            ← Back to Orders
          </Button>
          <h1 style={{ fontSize: 22, margin: 0 }}>Order {order.orderNumber}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {actionButtons.map((btn) => (
            <Button key={btn.type} variant={btn.variant} onClick={() => setPendingAction(btn.type)}>
              {btn.label}
            </Button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ ...cardStyle, flex: '1 1 260px' }}>
          <h3 style={{ marginTop: 0, fontSize: 14, color: '#6b7280' }}>Status</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge status={order.paymentStatus} />
          </div>
          <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>Placed {new Date(order.placedAt).toLocaleString()}</p>
          {order.confirmedAt && (
            <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>Confirmed {new Date(order.confirmedAt).toLocaleString()}</p>
          )}
        </div>

        <div style={{ ...cardStyle, flex: '1 1 260px' }}>
          <h3 style={{ marginTop: 0, fontSize: 14, color: '#6b7280' }}>Customer</h3>
          <p style={{ margin: 0, fontSize: 14 }}>{order.customerEmail}</p>
          {order.customerPhone && <p style={{ margin: 0, fontSize: 14, color: '#6b7280' }}>{order.customerPhone}</p>}
        </div>

        <div style={{ ...cardStyle, flex: '1 1 260px' }}>
          <h3 style={{ marginTop: 0, fontSize: 14, color: '#6b7280' }}>Totals</h3>
          <p style={{ margin: 0, fontSize: 14 }}>Subtotal: ₹{order.subtotal}</p>
          <p style={{ margin: 0, fontSize: 14 }}>Shipping: ₹{order.shippingAmount}</p>
          <p style={{ margin: 0, fontSize: 14 }}>Tax: ₹{order.taxAmount}</p>
          <p style={{ margin: 0, fontSize: 14 }}>Discount: ₹{order.discountAmount}</p>
          <p style={{ margin: '6px 0 0', fontSize: 14, fontWeight: 600 }}>Total: ₹{order.totalAmount}</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ ...cardStyle, flex: '1 1 260px' }}>
          <h3 style={{ marginTop: 0, fontSize: 14, color: '#6b7280' }}>Shipping Address</h3>
          {addressBlock(order.shippingAddress)}
          <p style={{ marginTop: 10, marginBottom: 0, fontSize: 13, color: '#6b7280' }}>
            Method: {order.shippingMethodName ?? '—'}
          </p>
        </div>

        <div style={{ ...cardStyle, flex: '1 1 260px' }}>
          <h3 style={{ marginTop: 0, fontSize: 14, color: '#6b7280' }}>Billing Address</h3>
          {addressBlock(order.billingAddress)}
        </div>

        <div style={{ ...cardStyle, flex: '1 1 260px' }}>
          <h3 style={{ marginTop: 0, fontSize: 14, color: '#6b7280' }}>Status Timeline</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#374151' }}>
            {order.confirmedAt && <li>Confirmed — {new Date(order.confirmedAt).toLocaleString()}</li>}
            {order.statusTimeline.map((entry) => (
              <li key={entry.status}>
                {formatOrderStatusLabel(entry.status)} — {new Date(entry.at).toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto', marginBottom: 16 }}>
        <h3 style={{ margin: '16px 20px 8px', fontSize: 14, color: '#6b7280' }}>Items</h3>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Product</th>
              <th style={thStyle}>SKU</th>
              <th style={thStyle}>Qty</th>
              <th style={thStyle}>Unit Price</th>
              <th style={thStyle}>Line Total</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item, index) => (
              <tr key={`${item.productId}-${item.variantId ?? index}`}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 500 }}>{item.name}</div>
                  {item.variantName && <div style={{ fontSize: 12, color: '#9ca3af' }}>{item.variantName}</div>}
                </td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{item.sku}</td>
                <td style={tdStyle}>{item.quantity}</td>
                <td style={tdStyle}>₹{item.unitPrice}</td>
                <td style={tdStyle}>₹{item.lineTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <h3 style={{ margin: '16px 20px 8px', fontSize: 14, color: '#6b7280' }}>Payments</h3>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Provider</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Amount</th>
              <th style={thStyle}>Paid At</th>
              <th style={thStyle}>Failure Reason</th>
            </tr>
          </thead>
          <tbody>
            {order.payments.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#9ca3af' }}>
                  No payment attempts recorded.
                </td>
              </tr>
            )}
            {order.payments.map((payment) => (
              <tr key={payment.id}>
                <td style={tdStyle}>{payment.provider}</td>
                <td style={tdStyle}>{payment.status}</td>
                <td style={tdStyle}>
                  {payment.amount} {payment.currency}
                </td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{payment.paidAt ? new Date(payment.paidAt).toLocaleString() : '—'}</td>
                <td style={{ ...tdStyle, color: '#dc2626' }}>{payment.failureReason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pendingAction && (
        <Modal title={ACTION_CONFIRM_LABELS[pendingAction]} onClose={() => { setPendingAction(null); setReason(''); }} width={420}>
          <p style={{ margin: '0 0 12px', color: '#374151', fontSize: 14 }}>{ACTION_LABELS[pendingAction]}</p>
          <TextAreaField
            label="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Add a note for this action…"
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <Button variant="secondary" onClick={() => { setPendingAction(null); setReason(''); }} disabled={isBusy}>
              Cancel
            </Button>
            <Button variant={pendingAction === 'CANCELLED' ? 'danger' : 'primary'} onClick={runAction} disabled={isBusy}>
              {isBusy ? 'Please wait…' : ACTION_CONFIRM_LABELS[pendingAction]}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
