'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../lib/auth-context';
import { useToast } from '../../lib/toast-context';
import { formatPrice } from '../../lib/format';
import { openRazorpayCheckout } from '../../lib/razorpay-checkout';
import type { CartResponse } from '../../types/cart';
import type { ShippingMethodOption } from '../../types/shipping';
import type { CouponValidationResult } from '../../types/coupon';

interface AddressForm {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

const EMPTY_ADDRESS: AddressForm = {
  fullName: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'India',
};

export default function CheckoutPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { show } = useToast();

  const [cart, setCart] = useState<(CartResponse & { readyForCheckout: boolean }) | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState<AddressForm>(EMPTY_ADDRESS);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [shippingMethods, setShippingMethods] = useState<ShippingMethodOption[]>([]);
  const [shippingMethodId, setShippingMethodId] = useState<string>('');
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<CouponValidationResult | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    setEmail(user.email);
    fetch('/api/checkout/validate', { method: 'POST' })
      .then((res) => res.json())
      .then(setCart)
      .finally(() => setIsLoading(false));
  }, [authLoading, user, router]);

  useEffect(() => {
    fetch('/api/shipping-methods/available')
      .then((res) => (res.ok ? res.json() : []))
      .then((methods: ShippingMethodOption[]) => {
        if (Array.isArray(methods) && methods.length > 0) {
          setShippingMethods(methods);
        }
      })
      .catch(() => {
        // Shipping methods are optional at checkout - fail silently and don't block the flow.
      });
  }, []);

  function updateAddress<K extends keyof AddressForm>(key: K, value: string) {
    setAddress((prev) => ({ ...prev, [key]: value }));
  }

  async function handleApplyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setIsApplyingCoupon(true);
    setCouponError(null);
    try {
      const res = await fetch('/api/checkout/coupon/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ couponCode: code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCouponError(data.message ?? 'This coupon could not be applied.');
        setAppliedCoupon(null);
        return;
      }
      setAppliedCoupon(data);
    } catch (err) {
      setCouponError((err as Error).message);
      setAppliedCoupon(null);
    } finally {
      setIsApplyingCoupon(false);
    }
  }

  function handleRemoveCoupon() {
    // Purely client-side: nothing was ever consumed by validating a coupon,
    // so removing it just clears local state - no server call needed.
    setAppliedCoupon(null);
    setCouponError(null);
    setCouponInput('');
  }

  async function handlePayNow(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setStatusMessage(null);

    try {
      const createRes = await fetch('/api/checkout/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          billingAddress: address,
          ...(shippingMethodId ? { shippingMethodId } : {}),
          ...(appliedCoupon ? { couponCode: appliedCoupon.couponCode } : {}),
        }),
      });
      const session = await createRes.json();
      if (!createRes.ok) {
        const message = session.message ?? 'Could not start checkout. Please review your cart and try again.';
        show(message, 'error');
        // If the create failed specifically because of the coupon (e.g. someone
        // else used up the last redemption in the meantime), drop it so the
        // customer can immediately retry without it blocking the order again.
        if (appliedCoupon && typeof session.message === 'string' && session.message.toLowerCase().includes('coupon')) {
          setAppliedCoupon(null);
          setCouponError(message);
        }
        setSubmitting(false);
        return;
      }

      await openRazorpayCheckout({
        key: session.razorpayKeyId,
        order_id: session.razorpayOrderId,
        amount: String(Math.round(Number(session.amount) * 100)),
        currency: session.currency,
        name: 'Peshani',
        description: `Order ${session.orderNumber}`,
        prefill: { email, contact: address.phone, name: address.fullName },
        handler: async (response) => {
          setStatusMessage('Payment verification in progress…');
          const verifyRes = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderNumber: session.orderNumber,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            }),
          });
          if (verifyRes.ok) {
            show('Payment successful');
          } else {
            show('We could not confirm your payment yet. Check your order for the latest status.', 'error');
          }
          router.push(`/orders/${session.orderNumber}`);
        },
        modal: {
          ondismiss: () => {
            setSubmitting(false);
            setStatusMessage(null);
            show('Payment cancelled - you can try again from your order.', 'error');
            router.push(`/orders/${session.orderNumber}`);
          },
        },
      });
    } catch (err) {
      show((err as Error).message, 'error');
      setSubmitting(false);
      setStatusMessage(null);
    }
  }

  if (authLoading || isLoading) {
    return (
      <main className="container">
        <div className="empty-state">Loading checkout…</div>
      </main>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <main className="container">
        <div className="empty-state">
          <p>Your cart is empty.</p>
          <Link href="/products" className="btn">
            Continue Shopping
          </Link>
        </div>
      </main>
    );
  }

  const canPay = cart.readyForCheckout && !submitting;

  const selectedShippingMethod = shippingMethods.find((m) => m.id === shippingMethodId);
  const shippingAmount = selectedShippingMethod ? selectedShippingMethod.price : '0.00';
  // Subtotal and discount come straight from the server's coupon validation
  // response when a coupon is applied - never recomputed in React.
  const summarySubtotal = appliedCoupon ? appliedCoupon.subtotal : cart.subtotal;
  const summaryDiscount = appliedCoupon ? appliedCoupon.discountAmount : '0.00';
  const summaryTotal = (Number(summarySubtotal) - Number(summaryDiscount) + Number(shippingAmount)).toFixed(2);

  return (
    <main className="container">
      <h1>Checkout</h1>
      <div className="cart-layout">
        <form className="checkout-form" onSubmit={handlePayNow}>
          <h2>Contact &amp; Delivery Address</h2>
          {!cart.readyForCheckout && (
            <p className="badge badge--out-of-stock" style={{ marginBottom: 16 }}>
              One or more items in your cart need attention before you can check out. Please review your cart.
            </p>
          )}
          <input className="field" type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="field" placeholder="Full name" required value={address.fullName} onChange={(e) => updateAddress('fullName', e.target.value)} />
          <input className="field" placeholder="Phone" required value={address.phone} onChange={(e) => updateAddress('phone', e.target.value)} />
          <input className="field" placeholder="Address line 1" required value={address.addressLine1} onChange={(e) => updateAddress('addressLine1', e.target.value)} />
          <input className="field" placeholder="Address line 2 (optional)" value={address.addressLine2} onChange={(e) => updateAddress('addressLine2', e.target.value)} />
          <div className="checkout-form__row">
            <input className="field" placeholder="City" required value={address.city} onChange={(e) => updateAddress('city', e.target.value)} />
            <input className="field" placeholder="State" required value={address.state} onChange={(e) => updateAddress('state', e.target.value)} />
          </div>
          <div className="checkout-form__row">
            <input className="field" placeholder="Postal code" required value={address.postalCode} onChange={(e) => updateAddress('postalCode', e.target.value)} />
            <input className="field" placeholder="Country" required value={address.country} onChange={(e) => updateAddress('country', e.target.value)} />
          </div>
          {shippingMethods.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: '1.05rem' }}>Shipping Method</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {shippingMethods.map((method) => (
                  <label
                    key={method.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      border: `1px solid ${shippingMethodId === method.id ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      borderRadius: 'var(--radius)',
                      padding: '10px 12px',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="shippingMethod"
                      value={method.id}
                      checked={shippingMethodId === method.id}
                      onChange={() => setShippingMethodId(method.id)}
                      style={{ marginTop: 4 }}
                    />
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <span>
                        <strong>{method.name}</strong> — {formatPrice(method.price)}
                      </span>
                      {method.estimatedDeliveryDays != null && (
                        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                          Estimated delivery: {method.estimatedDeliveryDays} day(s)
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: '1.05rem' }}>Coupon / Promo Code</h2>
            {!appliedCoupon ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="field"
                  placeholder="Enter coupon code"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value)}
                  style={{ marginBottom: 0 }}
                />
                <button
                  type="button"
                  className="btn btn--outline"
                  disabled={isApplyingCoupon || !couponInput.trim()}
                  onClick={() => void handleApplyCoupon()}
                >
                  {isApplyingCoupon ? 'Applying…' : 'Apply'}
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  padding: '10px 12px',
                }}
              >
                <span>
                  Coupon applied: <strong>{appliedCoupon.couponCode}</strong> - {formatPrice(appliedCoupon.discountAmount)}
                </span>
                <button type="button" className="btn--outline" onClick={handleRemoveCoupon} style={{ border: 'none' }}>
                  Remove coupon
                </button>
              </div>
            )}
            {couponError && <p style={{ color: 'var(--color-danger, #dc2626)', fontSize: '0.85rem' }}>{couponError}</p>}
          </div>
          {statusMessage && <p style={{ color: 'var(--color-text-muted)' }}>{statusMessage}</p>}
          <button type="submit" className="btn" disabled={!canPay} style={{ marginTop: 12 }}>
            {submitting ? 'Processing…' : `Pay Now - ${formatPrice(summaryTotal)}`}
          </button>
        </form>

        <aside className="cart-summary">
          <h2 style={{ marginTop: 0 }}>Order Summary</h2>
          {cart.items.map((item) => (
            <div key={item.id} className="cart-summary__row" style={{ fontSize: '0.9rem' }}>
              <span>
                {item.product.name} × {item.quantity}
              </span>
              <span>{formatPrice(item.lineTotal)}</span>
            </div>
          ))}
          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '12px 0' }} />
          <div className="cart-summary__row">
            <span>Subtotal</span>
            <span>{formatPrice(summarySubtotal)}</span>
          </div>
          <div className="cart-summary__row">
            <span>Shipping</span>
            <span>{formatPrice(shippingAmount)}</span>
          </div>
          {appliedCoupon && (
            <div className="cart-summary__row">
              <span>Discount ({appliedCoupon.couponCode})</span>
              <span>-{formatPrice(summaryDiscount)}</span>
            </div>
          )}
          <div className="cart-summary__row">
            <strong>Total</strong>
            <strong>{formatPrice(summaryTotal)}</strong>
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Payment is processed securely by Razorpay.</p>
        </aside>
      </div>
    </main>
  );
}
