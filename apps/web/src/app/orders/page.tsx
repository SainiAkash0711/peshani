'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatPrice } from '../../lib/format';
import type { OrderSummary } from '../../types/order';
import type { PaginatedResult } from '../../types/catalog';

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Payment Pending',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<PaginatedResult<OrderSummary> | null>(null);

  useEffect(() => {
    fetch('/api/orders')
      .then((res) => res.json())
      .then(setOrders);
  }, []);

  if (!orders) {
    return (
      <main className="container">
        <h1>Your Orders</h1>
        <div className="empty-state">Loading…</div>
      </main>
    );
  }

  if (orders.items.length === 0) {
    return (
      <main className="container">
        <h1>Your Orders</h1>
        <div className="empty-state">
          <p>You haven&apos;t placed any orders yet.</p>
          <Link href="/products" className="btn">
            Start Shopping
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <h1>Your Orders</h1>
      <div className="cart-lines">
        {orders.items.map((order) => (
          <Link key={order.orderNumber} href={`/orders/${order.orderNumber}`} className="cart-line" style={{ gridTemplateColumns: '1fr auto auto' }}>
            <div>
              <div className="cart-line__name">{order.orderNumber}</div>
              <div className="cart-line__variant">{new Date(order.createdAt).toLocaleDateString()}</div>
            </div>
            <span className={`badge ${order.status === 'CONFIRMED' ? 'badge--in-stock' : order.status === 'CANCELLED' ? 'badge--out-of-stock' : 'badge--low-stock'}`}>
              {STATUS_LABEL[order.status] ?? order.status}
            </span>
            <strong>{formatPrice(order.totalAmount)}</strong>
          </Link>
        ))}
      </div>
    </main>
  );
}
