'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../lib/auth-context';
import { useNotifications } from '../../lib/notification-context';
import { formatRelativeTime } from '../../lib/format';
import type { Notification, NotificationListResponse } from '../../types/notification';

const PAGE_SIZE = 20;

export default function NotificationsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { markAsRead, markAllAsRead } = useNotifications();

  const [items, setItems] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const loadPage = useCallback(async (pageToLoad: number, append: boolean) => {
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    try {
      const res = await fetch(`/api/notifications?page=${pageToLoad}&pageSize=${PAGE_SIZE}`, { cache: 'no-store' });
      if (!res.ok) {
        if (!append) setItems([]);
        return;
      }
      const data: NotificationListResponse = await res.json();
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

  async function handleMarkAsRead(id: string) {
    const ok = await markAsRead(id);
    if (ok) {
      const readAt = new Date().toISOString();
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? readAt } : n)));
    }
  }

  async function handleMarkAllAsRead() {
    const ok = await markAllAsRead();
    if (ok) {
      const readAt = new Date().toISOString();
      setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? readAt })));
    }
  }

  if (authLoading || !user || isLoading) {
    return (
      <main className="container">
        <h1>Notifications</h1>
        <div className="empty-state">Loading…</div>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="container">
        <h1>Notifications</h1>
        <div className="empty-state">
          <p>No notifications yet.</p>
          <Link href="/products" className="btn">
            Continue Shopping
          </Link>
        </div>
      </main>
    );
  }

  const hasMore = items.length < total;
  const hasUnread = items.some((n) => !n.readAt);

  return (
    <main className="container" style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Notifications</h1>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <Link href="/account/notification-preferences" style={{ fontSize: '0.9rem' }}>
            Manage preferences
          </Link>
          {hasUnread && (
            <button type="button" className="btn btn--outline" onClick={() => void handleMarkAllAsRead()}>
              Mark all as read
            </button>
          )}
        </div>
      </div>

      <div className="cart-lines" style={{ marginTop: 20 }}>
        {items.map((n) => {
          const isUnread = !n.readAt;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => isUnread && void handleMarkAsRead(n.id)}
              className="cart-line"
              style={{
                gridTemplateColumns: '1fr auto',
                textAlign: 'left',
                cursor: isUnread ? 'pointer' : 'default',
                background: isUnread ? 'var(--color-surface)' : 'transparent',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isUnread && (
                    <span
                      aria-hidden
                      style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626', flexShrink: 0 }}
                    />
                  )}
                  <span className="cart-line__name" style={{ fontWeight: isUnread ? 700 : 400 }}>
                    {n.title}
                  </span>
                </div>
                <div className="cart-line__variant" style={{ marginTop: 4 }}>
                  {n.message}
                </div>
              </div>
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                {formatRelativeTime(n.createdAt)}
              </span>
            </button>
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
