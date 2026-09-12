'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useToast } from '../../../lib/toast-context';
import { formatPrice } from '../../../lib/format';
import { openRazorpayCheckout } from '../../../lib/razorpay-checkout';
import { RETURN_REASON_LABEL, RETURN_REASON_OPTIONS } from '../../../lib/return-labels';
import type { OrderDetail } from '../../../types/order';
import type { ReturnEligibility, ReturnReason } from '../../../types/return';

const STATUS_LABELS: Record<string, string> = {
  PROCESSING: 'Processing',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

function formatStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.charAt(0) + status.slice(1).toLowerCase();
}

export default function OrderDetailPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = use(params);
  const { show } = useToast();
  const [order, setOrder] = useState<OrderDetail | null | undefined>(undefined);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const [eligibility, setEligibility] = useState<ReturnEligibility | null>(null);
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState<ReturnReason>('DAMAGED');
  const [returnComment, setReturnComment] = useState('');
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [createdReturnId, setCreatedReturnId] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/orders/${orderNumber}`);
    setOrder(res.ok ? await res.json() : null);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNumber]);

  // Return eligibility is the only source of truth for whether/what can be
  // returned - the backend independently re-validates everything again on
  // actual submission, this call just decides whether to show the button.
  useEffect(() => {
    if (!order || order.status !== 'DELIVERED') return;
    let cancelled = false;
    fetch(`/api/orders/${orderNumber}/return-eligibility`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setEligibility(data);
      })
      .catch(() => {
        if (!cancelled) setEligibility(null);
      });
    return () => {
      cancelled = true;
    };
  }, [order, orderNumber]);

  async function handleSubmitReturn() {
    const items = Object.entries(selectedQuantities)
      .filter(([, qty]) => qty > 0)
      .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
    if (items.length === 0) {
      show('Select at least one item and quantity to return', 'error');
      return;
    }
    setSubmittingReturn(true);
    try {
      const res = await fetch('/api/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber,
          items,
          reason: returnReason,
          customerComment: returnComment.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        show(data.message ?? 'Could not submit your return request. Please try again.', 'error');
        return;
      }
      setCreatedReturnId(data.id);
      show('Return request submitted');
    } catch {
      show('Could not reach the returns service. Please try again.', 'error');
    } finally {
      setSubmittingReturn(false);
    }
  }

  async function handleRetry() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/checkout/retry-payment/${orderNumber}`, { method: 'POST' });
      const session = await res.json();
      if (!res.ok) {
        show(session.message ?? 'Could not retry payment. Please try again.', 'error');
        setRetrying(false);
        return;
      }

      await openRazorpayCheckout({
        key: session.razorpayKeyId,
        order_id: session.razorpayOrderId,
        amount: String(Math.round(Number(session.amount) * 100)),
        currency: session.currency,
        name: 'Peshani',
        description: `Order ${orderNumber}`,
        handler: async (response) => {
          await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderNumber,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            }),
          });
          await load();
          setRetrying(false);
        },
        modal: { ondismiss: () => setRetrying(false) },
      });
    } catch (err) {
      show((err as Error).message, 'error');
      setRetrying(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/orders/${orderNumber}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        show(data.message ?? 'Could not cancel this order. Please try again.', 'error');
        setCancelling(false);
        setConfirmingCancel(false);
        return;
      }
      setOrder(data);
      show('Order cancelled');
    } catch (err) {
      show((err as Error).message, 'error');
    } finally {
      setCancelling(false);
      setConfirmingCancel(false);
    }
  }

  if (order === undefined) {
    return (
      <main className="container">
        <div className="empty-state">Loading order…</div>
      </main>
    );
  }

  if (order === null) {
    return (
      <main className="container">
        <div className="empty-state">
          <p>We couldn&apos;t find that order.</p>
          <Link href="/orders" className="btn">
            View Your Orders
          </Link>
        </div>
      </main>
    );
  }

  const eligibleItems = eligibility?.items.filter((item) => item.maxReturnableQuantity > 0) ?? [];

  return (
    <main className="container" style={{ maxWidth: 720 }}>
      {order.status === 'CONFIRMED' && (
        <div className="empty-state" style={{ padding: '32px 20px' }}>
          <span className="badge badge--in-stock">Payment successful</span>
          <h1 style={{ margin: '8px 0' }}>Thank you for your order!</h1>
          <p>
            Order <strong>{order.orderNumber}</strong> is confirmed.
          </p>
        </div>
      )}

      {order.status === 'PENDING_PAYMENT' && (
        <div className="empty-state" style={{ padding: '32px 20px' }}>
          <span className="badge badge--low-stock">Payment pending</span>
          <h1 style={{ margin: '8px 0' }}>Complete your payment</h1>
          <p>Order {order.orderNumber} is reserved but payment hasn&apos;t been completed yet.</p>
          <button type="button" className="btn" onClick={() => void handleRetry()} disabled={retrying}>
            {retrying ? 'Processing…' : 'Retry Payment'}
          </button>
        </div>
      )}

      {order.status === 'CANCELLED' && (
        <div className="empty-state" style={{ padding: '32px 20px' }}>
          <span className="badge badge--out-of-stock">Payment failed</span>
          <h1 style={{ margin: '8px 0' }}>This order was cancelled</h1>
          <p>Order {order.orderNumber} could not be completed. Please start a new checkout.</p>
          <Link href="/products" className="btn">
            Continue Shopping
          </Link>
        </div>
      )}

      {(order.status === 'PENDING_PAYMENT' || order.status === 'CONFIRMED') && (
        <div style={{ margin: '16px 0' }}>
          {!confirmingCancel ? (
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => setConfirmingCancel(true)}
              disabled={cancelling}
            >
              Cancel Order
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>Are you sure you want to cancel this order?</span>
              <button type="button" className="btn" onClick={() => void handleCancel()} disabled={cancelling}>
                {cancelling ? 'Cancelling…' : 'Yes, cancel it'}
              </button>
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => setConfirmingCancel(false)}
                disabled={cancelling}
              >
                No, keep order
              </button>
            </div>
          )}
        </div>
      )}

      <h2>Order Status</h2>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <li style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <strong>Order Placed</strong>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{new Date(order.placedAt).toLocaleString()}</span>
        </li>
        {order.confirmedAt && (
          <li style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <strong>Confirmed</strong>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{new Date(order.confirmedAt).toLocaleString()}</span>
          </li>
        )}
        {order.statusTimeline.map((entry) => (
          <li key={entry.status} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <strong>{formatStatusLabel(entry.status)}</strong>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{new Date(entry.at).toLocaleString()}</span>
          </li>
        ))}
      </ol>

      <h2>Order Details</h2>
      <div className="cart-lines">
        {order.items.map((item, index) => (
          <div key={index} className="cart-line" style={{ gridTemplateColumns: '56px 1fr auto' }}>
            <div className="cart-line__media">
              {item.image ? <img src={item.image} alt={item.name} /> : <span className="card__media--empty">No image</span>}
            </div>
            <div className="cart-line__details">
              <span className="cart-line__name">{item.name}</span>
              {item.variantName && <span className="cart-line__variant">{item.variantName}</span>}
              <span className="cart-line__variant">
                Qty {item.quantity} × {formatPrice(item.unitPrice)}
              </span>
            </div>
            <strong>{formatPrice(item.lineTotal)}</strong>
          </div>
        ))}
      </div>

      <div className="cart-summary" style={{ marginTop: 20 }}>
        <div className="cart-summary__row">
          <span>Subtotal</span>
          <span>{formatPrice(order.subtotal)}</span>
        </div>
        <div className="cart-summary__row">
          <span>Shipping</span>
          <span>{formatPrice(order.shippingAmount)}</span>
        </div>
        {Number(order.discountAmount) > 0 && (
          <div className="cart-summary__row">
            <span>Discount{order.couponCode ? ` (${order.couponCode})` : ''}</span>
            <span>-{formatPrice(order.discountAmount)}</span>
          </div>
        )}
        <div className="cart-summary__row">
          <strong>Total</strong>
          <strong>{formatPrice(order.totalAmount)}</strong>
        </div>
      </div>

      <h2>Shipping To</h2>
      <p>
        {order.shippingAddress.fullName}
        <br />
        {order.shippingAddress.addressLine1}
        {order.shippingAddress.addressLine2 ? `, ${order.shippingAddress.addressLine2}` : ''}
        <br />
        {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}
        <br />
        {order.shippingAddress.country}
      </p>
      {order.shippingMethodName && (
        <p style={{ color: 'var(--color-text-muted)' }}>
          Shipping method: <strong>{order.shippingMethodName}</strong>
        </p>
      )}

      {order.status === 'DELIVERED' && eligibility?.eligible && eligibleItems.length > 0 && (
        <div style={{ marginTop: 32, borderTop: '1px solid #e5e7eb', paddingTop: 24 }}>
          {createdReturnId ? (
            <div className="empty-state">
              <p>Your return request has been submitted.</p>
              <Link href={`/returns/${createdReturnId}`} className="btn">
                View Return Request
              </Link>
            </div>
          ) : !showReturnForm ? (
            <button type="button" className="btn btn--outline" onClick={() => setShowReturnForm(true)}>
              Request Return
            </button>
          ) : (
            <div style={{ maxWidth: 480 }}>
              <h2 style={{ marginTop: 0 }}>Request a Return</h2>
              {eligibility.eligibleUntil && (
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                  Eligible until {new Date(eligibility.eligibleUntil).toLocaleDateString()}
                </p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {eligibleItems.map((item) => (
                  <div
                    key={item.orderItemId}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}
                  >
                    <div>
                      <div>{item.productNameSnapshot}</div>
                      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                        Up to {item.maxReturnableQuantity} of {item.purchasedQuantity} returnable
                      </div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={item.maxReturnableQuantity}
                      value={selectedQuantities[item.orderItemId] ?? 0}
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        const clamped = Math.max(0, Math.min(item.maxReturnableQuantity, Number.isNaN(raw) ? 0 : raw));
                        setSelectedQuantities((prev) => ({ ...prev, [item.orderItemId]: clamped }));
                      }}
                      style={{ width: 64, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6 }}
                    />
                  </div>
                ))}

                <div>
                  <label htmlFor="return-reason" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
                    Reason
                  </label>
                  <select
                    id="return-reason"
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value as ReturnReason)}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6 }}
                  >
                    {RETURN_REASON_OPTIONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {RETURN_REASON_LABEL[reason]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="return-comment" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
                    Comment (optional)
                  </label>
                  <textarea
                    id="return-comment"
                    value={returnComment}
                    onChange={(e) => setReturnComment(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, resize: 'vertical' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="button" className="btn" disabled={submittingReturn} onClick={() => void handleSubmitReturn()}>
                    {submittingReturn ? 'Submitting…' : 'Submit Return Request'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--outline"
                    disabled={submittingReturn}
                    onClick={() => setShowReturnForm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
