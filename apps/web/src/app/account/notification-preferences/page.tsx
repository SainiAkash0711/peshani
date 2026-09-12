'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { useToast } from '../../../lib/toast-context';
import type { NotificationPreferenceKey, NotificationPreferences } from '../../../types/notification';

interface PreferenceRow {
  label: string;
  inAppKey: NotificationPreferenceKey;
  emailKey: NotificationPreferenceKey;
}

interface PreferenceSection {
  title: string;
  description?: string;
  rows: PreferenceRow[];
}

const SECTIONS: PreferenceSection[] = [
  {
    title: 'Order & Delivery',
    rows: [
      { label: 'Order confirmations', inAppKey: 'IN_APP_ORDER_UPDATES', emailKey: 'EMAIL_ORDER_UPDATES' },
      { label: 'Shipping updates (packed, shipped, delivered)', inAppKey: 'IN_APP_SHIPPING_UPDATES', emailKey: 'EMAIL_SHIPPING_UPDATES' },
    ],
  },
  {
    title: 'Payment',
    description: 'Critical payment failure and order cancellation notices are always sent and cannot be disabled.',
    rows: [{ label: 'Payment receipts', inAppKey: 'IN_APP_PAYMENT_UPDATES', emailKey: 'EMAIL_PAYMENT_UPDATES' }],
  },
  {
    title: 'Reviews',
    rows: [{ label: 'Review moderation outcomes', inAppKey: 'IN_APP_REVIEW_UPDATES', emailKey: 'EMAIL_REVIEW_UPDATES' }],
  },
  {
    title: 'Promotions',
    description: 'Marketing messages about promotions and coupons - entirely optional, feel free to turn these off.',
    rows: [{ label: 'Promotions & coupons', inAppKey: 'IN_APP_PROMOTION_UPDATES', emailKey: 'EMAIL_PROMOTION_UPDATES' }],
  },
];

export default function NotificationPreferencesPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { show } = useToast();
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<NotificationPreferenceKey | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    fetch('/api/notification-preferences', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then(setPreferences)
      .finally(() => setIsLoading(false));
  }, [authLoading, user, router]);

  // Each checkbox saves immediately (a single-key PATCH) rather than through
  // a page-level submit button: the API already accepts partial updates for
  // exactly this reason, and with ten independent switches a bulk "Save"
  // button would leave it ambiguous whether a given toggle actually took
  // effect. Optimistic update with rollback + toast on failure.
  async function handleToggle(key: NotificationPreferenceKey, value: boolean) {
    if (!preferences) return;
    const previous = preferences;
    setPreferences({ ...preferences, [key]: value });
    setSavingKey(key);
    try {
      const res = await fetch('/api/notification-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) {
        setPreferences(previous);
        const data = await res.json().catch(() => ({}));
        show(data.message ?? 'Could not save that preference. Please try again.', 'error');
        return;
      }
      setPreferences(await res.json());
    } catch {
      setPreferences(previous);
      show('Could not reach the notification service. Please try again.', 'error');
    } finally {
      setSavingKey(null);
    }
  }

  if (authLoading || !user || isLoading) {
    return (
      <main className="container" style={{ maxWidth: 640 }}>
        <h1>Notification Preferences</h1>
        <div className="empty-state">Loading…</div>
      </main>
    );
  }

  if (!preferences) {
    return (
      <main className="container" style={{ maxWidth: 640 }}>
        <h1>Notification Preferences</h1>
        <div className="empty-state">
          <p>We couldn&apos;t load your notification preferences. Please try again.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="container" style={{ maxWidth: 640 }}>
      <h1>Notification Preferences</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>
        Choose how you&apos;d like to hear from us. Each row has two independent switches: in-app notifications and email.
      </p>

      {SECTIONS.map((section) => (
        <div key={section.title} style={{ marginTop: 32 }}>
          <h2 style={{ marginBottom: section.description ? 4 : 12, fontSize: '1.15rem' }}>{section.title}</h2>
          {section.description && (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 0, marginBottom: 12 }}>
              {section.description}
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {section.rows.map((row) => (
              <div
                key={row.inAppKey}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  padding: '12px 16px',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontWeight: 600 }}>{row.label}</span>
                <div style={{ display: 'flex', gap: 20 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem' }}>
                    <input
                      type="checkbox"
                      checked={preferences[row.inAppKey]}
                      disabled={savingKey === row.inAppKey}
                      onChange={(e) => void handleToggle(row.inAppKey, e.target.checked)}
                    />
                    In-app
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem' }}>
                    <input
                      type="checkbox"
                      checked={preferences[row.emailKey]}
                      disabled={savingKey === row.emailKey}
                      onChange={(e) => void handleToggle(row.emailKey, e.target.checked)}
                    />
                    Email
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </main>
  );
}
