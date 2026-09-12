'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../lib/auth-context';
import { useToast } from '../../../lib/toast-context';
import { formatPrice } from '../../../lib/format';
import {
  ITEM_CONDITION_LABEL,
  ITEM_DISPOSITION_LABEL,
  REFUND_STATUS_LABEL,
  RETURN_REASON_LABEL,
  formatReturnStatusLabel,
  returnStatusBadgeClass,
} from '../../../lib/return-labels';
import type { ReturnRequest } from '../../../types/return';

interface TimelineStep {
  key: string;
  label: string;
  at: string | null;
  negative?: boolean;
}

// Driven entirely by which timestamp fields are non-null - never a fixed
// path - branching into a Rejected or Cancelled tail when those timestamps
// are set instead of the normal happy-path steps.
function buildTimeline(r: ReturnRequest): TimelineStep[] {
  if (r.rejectedAt) {
    return [
      { key: 'requested', label: 'Requested', at: r.requestedAt },
      { key: 'rejected', label: 'Rejected', at: r.rejectedAt, negative: true },
    ];
  }
  if (r.cancelledAt) {
    return [
      { key: 'requested', label: 'Requested', at: r.requestedAt },
      { key: 'approved', label: 'Approved', at: r.approvedAt },
      { key: 'cancelled', label: 'Cancelled', at: r.cancelledAt, negative: true },
    ];
  }
  return [
    { key: 'requested', label: 'Requested', at: r.requestedAt },
    { key: 'approved', label: 'Approved', at: r.approvedAt },
    { key: 'inTransit', label: 'In Transit', at: r.inTransitAt },
    { key: 'received', label: 'Received', at: r.receivedAt },
    { key: 'refundInitiated', label: 'Refund Initiated', at: r.refundInitiatedAt },
    { key: 'completed', label: 'Completed', at: r.completedAt },
  ];
}

export default function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { show } = useToast();
  const [ret, setRet] = useState<ReturnRequest | null | undefined>(undefined);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch(`/api/returns/${id}`, { cache: 'no-store' });
    setRet(res.ok ? await res.json() : null);
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, router, id]);

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/returns/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        show(data.message ?? 'Could not cancel this return. Please try again.', 'error');
        return;
      }
      setRet(data);
      show('Return cancelled');
    } catch {
      show('Could not reach the returns service. Please try again.', 'error');
    } finally {
      setCancelling(false);
      setConfirmingCancel(false);
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/returns/${id}/evidence`, { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        show(data.message ?? 'Could not upload the photo. Please try again.', 'error');
        return;
      }
      setRet((prev) => (prev ? { ...prev, evidence: [...prev.evidence, data] } : prev));
      show('Photo uploaded');
    } catch {
      show('Could not reach the returns service. Please try again.', 'error');
    } finally {
      setUploading(false);
    }
  }

  if (authLoading || !user || ret === undefined) {
    return (
      <main className="container">
        <div className="empty-state">Loading…</div>
      </main>
    );
  }

  if (ret === null) {
    return (
      <main className="container">
        <div className="empty-state">
          <p>We couldn&apos;t find that return.</p>
          <Link href="/returns" className="btn">
            View Your Returns
          </Link>
        </div>
      </main>
    );
  }

  const timeline = buildTimeline(ret);
  const cancellable = ret.status === 'REQUESTED' || ret.status === 'UNDER_REVIEW';

  return (
    <main className="container" style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Return for Order {ret.order.orderNumber}</h1>
        <span className={`badge ${returnStatusBadgeClass(ret.status)}`}>{formatReturnStatusLabel(ret.status)}</span>
      </div>
      <p style={{ color: 'var(--color-text-muted)' }}>
        <Link href={`/orders/${ret.order.orderNumber}`}>View order details</Link>
      </p>

      <p>
        <strong>Reason:</strong> {RETURN_REASON_LABEL[ret.reason] ?? ret.reason}
      </p>
      {ret.customerComment && (
        <p>
          <strong>Your comment:</strong> {ret.customerComment}
        </p>
      )}
      {ret.adminComment && (
        <p>
          <strong>Note from our team:</strong> {ret.adminComment}
        </p>
      )}

      {cancellable && (
        <div style={{ margin: '16px 0' }}>
          {!confirmingCancel ? (
            <button type="button" className="btn btn--outline" onClick={() => setConfirmingCancel(true)} disabled={cancelling}>
              Cancel Return
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>Are you sure you want to cancel this return?</span>
              <button type="button" className="btn" onClick={() => void handleCancel()} disabled={cancelling}>
                {cancelling ? 'Cancelling…' : 'Yes, cancel it'}
              </button>
              <button type="button" className="btn btn--outline" onClick={() => setConfirmingCancel(false)} disabled={cancelling}>
                No, keep return
              </button>
            </div>
          )}
        </div>
      )}

      <h2>Status</h2>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {timeline.map((step) => {
          const reached = Boolean(step.at);
          return (
            <li key={step.key} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: reached ? (step.negative ? '#dc2626' : '#166534') : '#d1d5db',
                }}
              />
              <strong style={{ color: reached ? 'inherit' : 'var(--color-text-muted)' }}>{step.label}</strong>
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                {reached ? new Date(step.at as string).toLocaleString() : 'Not yet reached'}
              </span>
            </li>
          );
        })}
      </ol>

      <h2>Items</h2>
      <div className="cart-lines">
        {ret.items.map((item) => (
          <div key={item.id} className="cart-line" style={{ gridTemplateColumns: '1fr auto' }}>
            <div className="cart-line__details">
              <span className="cart-line__name">{item.orderItem.productNameSnapshot}</span>
              {item.orderItem.variantNameSnapshot && <span className="cart-line__variant">{item.orderItem.variantNameSnapshot}</span>}
              <span className="cart-line__variant">
                Qty {item.quantity} · Reason: {RETURN_REASON_LABEL[item.reason] ?? item.reason}
              </span>
              {item.itemCondition && (
                <span className="cart-line__variant">Condition: {ITEM_CONDITION_LABEL[item.itemCondition]}</span>
              )}
              {item.disposition && (
                <span className="cart-line__variant">Disposition: {ITEM_DISPOSITION_LABEL[item.disposition]}</span>
              )}
            </div>
            <strong>{item.refundAmount ? formatPrice(item.refundAmount) : '—'}</strong>
          </div>
        ))}
      </div>

      {ret.refunds.length > 0 && (
        <>
          <h2>Refund</h2>
          {ret.refunds.map((refund) => (
            <div key={refund.id} className="cart-summary" style={{ marginTop: 12 }}>
              <div className="cart-summary__row">
                <span>Amount</span>
                <span>{formatPrice(refund.amount)}</span>
              </div>
              <div className="cart-summary__row">
                <span>Status</span>
                <span>{REFUND_STATUS_LABEL[refund.status] ?? refund.status}</span>
              </div>
              {refund.failureReason && (
                <div className="cart-summary__row">
                  <span>Reason</span>
                  <span>{refund.failureReason}</span>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      <h2>Evidence</h2>
      {ret.evidence.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No photos uploaded yet.</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {ret.evidence.map((ev) => (
            <a
              key={ev.id}
              href={ev.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'block', width: 96, height: 96, borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e7eb' }}
            >
              <img src={ev.url} alt={ev.originalFilename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </a>
          ))}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => void handleFileSelect(e)}
          ref={fileInputRef}
          style={{ display: 'none' }}
        />
        <button type="button" className="btn btn--outline" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          {uploading ? 'Uploading…' : 'Add Photo Evidence'}
        </button>
      </div>
    </main>
  );
}
