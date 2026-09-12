'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Notification, NotificationListResponse, UnreadCountResponse } from '../types/notification';
import { useToast } from './toast-context';

// No existing context in this app polls on an interval, so this follows the
// spec's own fallback guidance: refresh roughly once a minute, plus whenever
// the tab regains focus (catches notifications that arrived while away
// without needing a much more aggressive interval).
const POLL_INTERVAL_MS = 60_000;

// How many of the most recent notifications the header bell dropdown shows.
const RECENT_LIMIT = 10;

interface NotificationContextValue {
  unreadCount: number;
  recentNotifications: Notification[];
  isLoading: boolean;
  refreshUnreadCount: () => Promise<void>;
  refreshRecent: () => Promise<void>;
  markAsRead: (id: string) => Promise<boolean>;
  markAllAsRead: () => Promise<boolean>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [recentNotifications, setRecentNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { show } = useToast();

  const refreshUnreadCount = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/unread-count', { cache: 'no-store' });
      if (!res.ok) {
        // Not signed in (or nothing to count yet) - treat as zero, no error noise.
        setUnreadCount(0);
        return;
      }
      const data: UnreadCountResponse = await res.json();
      setUnreadCount(data.count ?? 0);
    } catch {
      setUnreadCount(0);
    }
  }, []);

  const refreshRecent = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/notifications?page=1&pageSize=${RECENT_LIMIT}`, { cache: 'no-store' });
      if (!res.ok) {
        setRecentNotifications([]);
        return;
      }
      const data: NotificationListResponse = await res.json();
      // The bell dropdown is meant for in-app alerts; an EMAIL-channel row
      // represents an email that was already sent elsewhere, so we filter
      // those out client-side rather than showing them as separate alerts.
      setRecentNotifications(data.items.filter((item) => item.channel === 'IN_APP'));
    } catch {
      setRecentNotifications([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUnreadCount();
    void refreshRecent();
  }, [refreshUnreadCount, refreshRecent]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refreshUnreadCount();
      void refreshRecent();
    }, POLL_INTERVAL_MS);
    const onFocus = () => {
      void refreshUnreadCount();
      void refreshRecent();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshUnreadCount, refreshRecent]);

  const markAsRead = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
        if (!res.ok) {
          show('Could not mark that notification as read', 'error');
          return false;
        }
        const readAt = new Date().toISOString();
        setRecentNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? readAt } : n)));
        await refreshUnreadCount();
        return true;
      } catch {
        show('Could not reach the notification service. Please try again.', 'error');
        return false;
      }
    },
    [refreshUnreadCount, show],
  );

  const markAllAsRead = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/read-all', { method: 'PATCH' });
      if (!res.ok) {
        show('Could not mark notifications as read', 'error');
        return false;
      }
      const readAt = new Date().toISOString();
      setRecentNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? readAt })));
      await refreshUnreadCount();
      return true;
    } catch {
      show('Could not reach the notification service. Please try again.', 'error');
      return false;
    }
  }, [refreshUnreadCount, show]);

  const value = useMemo(
    () => ({ unreadCount, recentNotifications, isLoading, refreshUnreadCount, refreshRecent, markAsRead, markAllAsRead }),
    [unreadCount, recentNotifications, isLoading, refreshUnreadCount, refreshRecent, markAsRead, markAllAsRead],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
