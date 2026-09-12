'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../lib/auth-context';
import { formatPrice } from '../../lib/format';
import { REFUND_STATUS_LABEL, formatReturnStatusLabel, returnStatusBadgeClass } from '../../lib/return-labels';
import type { ReturnListResult, ReturnRequest } from '../../types/return';

const PAGE_SIZE = 10;

export default function ReturnsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [items, setItems] = useState<ReturnRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const loadPage = useCallback(async (pageToLoad: number, append: boolean) => {
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    try {
      const res = await fetch(`/api/returns?page=${pageToLoad}&pageSize=${PAGE_SIZE}`, { cache: 'no-store' });
      if (!res.ok) {
        if (!append) setItems([]);
        return;
      }
      const data: ReturnListResult = await res.json();
      setItems((prev) => (append ? [...prev, ...data.items] : data.items));
      setTotal(data.total);
      setPage(data.page);
    } finally {
      if (append) setIsLoadingMore(false);
      else setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    void loadPage(1, false);
  }, [authLoading, user, router, loadPage]);

  if (authLoading || !user || isLoading) {
    return (
      <main className="container">
        <h1>My Returns</h1>
        <div className="empty-state">Loading…</div>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="container">
        <h1>My Returns</h1>
        <div className="empty-state">
          <p>You haven&apos;t requested any returns yet.</p>
          <Link href="/orders" className="btn">
            View Your Orders
          </Link>
        </div>
      </main>
    );
  }

  const hasMore = items.length < total;

  return (
    <main className="container" style={{ maxWidth: 720 }}>
      <h1>My Returns</h1>
      <div className="cart-lines">
        {items.map((r) => {
          // Backend returns refunds ordered newest-first (createdAt desc),
          // so the current attempt is always index 0, not the last entry.
          const refund = r.refunds[0];
          return (
            <div key={r.id} className="cart-line" style={{ gridTemplateColumns: '1fr auto auto' }}>
              <div className="cart-line__details">
                <Link href={`/orders/${r.order.orderNumber}`} className="cart-line__name">
                  Order {r.order.orderNumber}
                </Link>
                <span className="cart-line__variant">Requested {new Date(r.requestedAt).toLocaleDateString()}</span>
                {refund && (
                  <span className="cart-line__variant">
                    Refund {formatPrice(refund.amount)} · {REFUND_STATUS_LABEL[refund.status] ?? refund.status}
                  </span>
                )}
              </div>
              <span className={`badge ${returnStatusBadgeClass(r.status)}`}>{formatReturnStatusLabel(r.status)}</span>
              <Link
                href={`/returns/${r.id}`}
                className="btn btn--outline"
                style={{ padding: '6px 12px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
              >
                View Details
              </Link>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button type="button" className="btn btn--outline" disabled={isLoadingMore} onClick={() => void loadPage(page + 1, true)}>
            {isLoadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </main>
  );
}
