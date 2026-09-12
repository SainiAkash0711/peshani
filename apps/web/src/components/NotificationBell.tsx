'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { useNotifications } from '../lib/notification-context';
import { formatRelativeTime } from '../lib/format';
import type { Notification } from '../types/notification';

// How many recent notifications the header dropdown shows - the full history
// lives on the /notifications page.
const DROPDOWN_LIMIT = 8;

function NotificationRow({ notification, onRead }: { notification: Notification; onRead: (id: string) => void }) {
  const isUnread = !notification.readAt;

  return (
    <button
      type="button"
      onClick={() => isUnread && onRead(notification.id)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '10px 14px',
        border: 'none',
        borderBottom: '1px solid var(--color-border)',
        background: isUnread ? 'var(--color-surface)' : 'transparent',
        cursor: isUnread ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            marginTop: 6,
            borderRadius: '50%',
            background: isUnread ? '#dc2626' : 'transparent',
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: isUnread ? 700 : 400, fontSize: '0.9rem' }}>{notification.title}</div>
          <div
            style={{
              fontSize: '0.8rem',
              color: 'var(--color-text-muted)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {notification.message}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            {formatRelativeTime(notification.createdAt)}
          </div>
        </div>
      </div>
    </button>
  );
}

export function NotificationBell() {
  const { user } = useAuth();
  const { unreadCount, recentNotifications, markAsRead, markAllAsRead, refreshRecent } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Not signed in - notifications are a customer-account feature, so hide the bell entirely.
  if (!user) return null;

  function handleToggle() {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) void refreshRecent();
      return next;
    });
  }

  const items = recentNotifications.slice(0, DROPDOWN_LIMIT);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={handleToggle}
        aria-label="Notifications"
        aria-haspopup="true"
        aria-expanded={isOpen}
        style={{
          position: 'relative',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          font: 'inherit',
          color: 'inherit',
          padding: 0,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span aria-hidden style={{ fontSize: '1.15rem', lineHeight: 1 }}>
          🔔
        </span>
        {unreadCount > 0 && (
          <span
            aria-hidden
            style={{
              background: '#dc2626',
              color: '#fff',
              borderRadius: 999,
              fontSize: '0.7rem',
              fontWeight: 700,
              padding: '1px 6px',
              lineHeight: 1.4,
              minWidth: 18,
              textAlign: 'center',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 12px)',
            width: 340,
            maxWidth: '90vw',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            zIndex: 50,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <strong style={{ fontSize: '0.9rem' }}>Notifications</strong>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAllAsRead()}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-accent)', fontSize: '0.8rem', padding: 0 }}
              >
                Mark all as read
              </button>
            )}
          </div>

          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {items.length === 0 ? (
              <div className="empty-state" style={{ padding: '32px 20px' }}>
                <p style={{ margin: 0 }}>No notifications yet.</p>
              </div>
            ) : (
              items.map((n) => <NotificationRow key={n.id} notification={n} onRead={(id) => void markAsRead(id)} />)
            )}
          </div>

          <div style={{ padding: '10px 14px', textAlign: 'center', borderTop: '1px solid var(--color-border)' }}>
            <Link href="/notifications" onClick={() => setIsOpen(false)} style={{ fontSize: '0.85rem' }}>
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
