'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { useToast } from '../lib/toast-context';
import type { PaginatedResult } from '../types/catalog';
import type { OrderDetail, OrderSummary } from '../types/order';

// How many of the customer's most recent DELIVERED orders we'll open up (via
// GET /orders/:orderNumber) while looking for an item that matches this
// product. GET /orders already caps pageSize at 100 (MAX_PAGE_SIZE on the
// API), so a single page-1 fetch already covers "recent order history" for
// any real store account; this second cap just bounds how many detail
// look-ups we do within that page once orders that were never delivered are
// filtered out, so a customer with an unusually long delivered history still
// gets a bounded number of requests rather than checking all of them.
const ORDERS_PAGE_SIZE = 100;
const MAX_DELIVERED_ORDERS_TO_CHECK = 30;

interface EligibleItem {
  orderItemId: string;
  variantId: string | null;
}

type EligibilityState =
  | { status: 'checking' }
  | { status: 'eligible'; item: EligibleItem }
  | { status: 'ineligible' }
  | { status: 'error' };

async function findEligibleOrderItem(productId: string): Promise<EligibleItem | null> {
  const listRes = await fetch(`/api/orders?page=1&pageSize=${ORDERS_PAGE_SIZE}`, { cache: 'no-store' });
  if (!listRes.ok) return null;
  const list: PaginatedResult<OrderSummary> = await listRes.json();
  const delivered = list.items.filter((order) => order.status === 'DELIVERED').slice(0, MAX_DELIVERED_ORDERS_TO_CHECK);

  for (const order of delivered) {
    const detailRes = await fetch(`/api/orders/${encodeURIComponent(order.orderNumber)}`, { cache: 'no-store' });
    if (!detailRes.ok) continue;
    const detail: OrderDetail = await detailRes.json();
    const match = detail.items.find((item) => item.productId === productId);
    if (match) return { orderItemId: match.id, variantId: match.variantId };
  }
  return null;
}

function StarPicker({ value, onChange }: { value: number; onChange: (rating: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Rating" style={{ fontSize: '1.5rem', lineHeight: 1 }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
          onClick={() => onChange(star)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 2,
            color: star <= value ? '#f59e0b' : '#e5e7eb',
          }}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function WriteReview({ productId }: { productId: string }) {
  const { user, isLoading: authLoading } = useAuth();
  const { show } = useToast();
  const [eligibility, setEligibility] = useState<EligibilityState>({ status: 'checking' });
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setEligibility({ status: 'ineligible' });
      return;
    }
    let cancelled = false;
    setEligibility({ status: 'checking' });
    findEligibleOrderItem(productId)
      .then((item) => {
        if (cancelled) return;
        setEligibility(item ? { status: 'eligible', item } : { status: 'ineligible' });
      })
      .catch(() => {
        if (!cancelled) setEligibility({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, productId]);

  async function handleSubmit(item: EligibleItem) {
    if (rating < 1) {
      show('Please select a rating', 'error');
      return;
    }
    if (!body.trim()) {
      show('Please write a review before submitting', 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          variantId: item.variantId ?? undefined,
          orderItemId: item.orderItemId,
          rating,
          title: title.trim() || undefined,
          body: body.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 201) {
        setSubmitted(true);
        return;
      }
      if (res.status === 409 && typeof data.message === 'string' && /already reviewed/i.test(data.message)) {
        setAlreadyReviewed(true);
        return;
      }
      // Covers the 409 "must be delivered" case and any other 4xx - always
      // surface the backend's own message rather than inventing our own text.
      show(data.message ?? 'Could not submit your review. Please try again.', 'error');
    } catch {
      show('Could not reach the review service. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (authLoading || eligibility.status === 'checking') {
    return null;
  }

  if (!user) {
    return (
      <div className="empty-state" style={{ marginTop: 24 }}>
        <p>Have you bought this product?</p>
        <Link href="/login" className="btn">
          Sign in to write a review
        </Link>
      </div>
    );
  }

  if (eligibility.status === 'error') {
    return null;
  }

  if (eligibility.status === 'ineligible') {
    return (
      <div className="empty-state" style={{ marginTop: 24 }}>
        <p>You can review this product after your order has been delivered.</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="empty-state" style={{ marginTop: 24 }}>
        <p>Review submitted! It will appear once approved.</p>
      </div>
    );
  }

  if (alreadyReviewed) {
    return (
      <div className="empty-state" style={{ marginTop: 24 }}>
        <p>You&apos;ve already reviewed this item.</p>
      </div>
    );
  }

  const { item } = eligibility;

  return (
    <div style={{ marginTop: 24, borderTop: '1px solid #e5e7eb', paddingTop: 24 }}>
      <h3 style={{ marginTop: 0 }}>Write a Review</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Rating</label>
          <StarPicker value={rating} onChange={setRating} />
        </div>
        <div>
          <label htmlFor="review-title" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Title (optional)
          </label>
          <input
            id="review-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={150}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6 }}
          />
        </div>
        <div>
          <label htmlFor="review-body" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Review
          </label>
          <textarea
            id="review-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={5000}
            rows={5}
            required
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, resize: 'vertical' }}
          />
        </div>
        <button
          type="button"
          className="btn"
          disabled={isSubmitting}
          onClick={() => void handleSubmit(item)}
          style={{ alignSelf: 'flex-start' }}
        >
          {isSubmitting ? 'Submitting…' : 'Submit Review'}
        </button>
      </div>
    </div>
  );
}
