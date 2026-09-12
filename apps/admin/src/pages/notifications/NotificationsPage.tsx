import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { useAuth } from '../../lib/auth-context';
import { Modal } from '../../components/Modal';
import { Pagination } from '../../components/Pagination';
import { NoAccess } from '../../components/NoAccess';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/TableStates';
import { pageHeaderStyle, tableStyle, tdStyle, thStyle, toolbarStyle, inputStyle, cardStyle } from '../../styles';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_LABELS,
} from '../../lib/notification-meta';
import {
  AdminNotification,
  AdminNotificationsListResult,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationType,
} from '../../types/notifications';

const PAGE_SIZE = 20;

const STATUS_STYLES: Record<NotificationDeliveryStatus, { background: string; color: string }> = {
  PENDING: { background: '#fef9c3', color: '#a16207' },
  PROCESSING: { background: '#dbeafe', color: '#1d4ed8' },
  SENT: { background: '#dcfce7', color: '#15803d' },
  FAILED: { background: '#fee2e2', color: '#dc2626' },
};

function DeliveryStatusBadge({ status }: { status: NotificationDeliveryStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: style.background,
        color: style.color,
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  );
}

function customerLabel(notification: AdminNotification): { name: string; email: string } {
  const { user } = notification;
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return { name: fullName || user.email, email: user.email };
}

export function NotificationsPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('notification.read');

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'' | NotificationDeliveryStatus>('');
  const [channel, setChannel] = useState<'' | NotificationChannel>('');
  const [type, setType] = useState<'' | NotificationType>('');
  const [userId, setUserId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [detail, setDetail] = useState<AdminNotification | null>(null);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  if (status) params.set('status', status);
  if (channel) params.set('channel', channel);
  if (type) params.set('type', type);
  if (userId.trim()) params.set('userId', userId.trim());
  if (fromDate) params.set('fromDate', fromDate);
  if (toDate) params.set('toDate', toDate);

  const listQuery = useQuery({
    queryKey: ['admin-notifications', 'list', page, status, channel, type, userId, fromDate, toDate],
    queryFn: () => apiClient.get<AdminNotificationsListResult>(`/admin/notifications?${params.toString()}`),
    enabled: canRead,
  });

  if (!canRead) {
    return <NoAccess message="You don't have permission to view notifications." />;
  }

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const pageSize = listQuery.data?.pageSize ?? PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const columnCount = 7;

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Notifications</h1>
      </div>

      <div style={toolbarStyle}>
        <select
          style={inputStyle}
          value={status}
          onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}
        >
          <option value="">All statuses</option>
          {NOTIFICATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          style={inputStyle}
          value={channel}
          onChange={(e) => { setChannel(e.target.value as typeof channel); setPage(1); }}
        >
          <option value="">All channels</option>
          {NOTIFICATION_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {NOTIFICATION_CHANNEL_LABELS[c]}
            </option>
          ))}
        </select>
        <select style={inputStyle} value={type} onChange={(e) => { setType(e.target.value as typeof type); setPage(1); }}>
          <option value="">All types</option>
          {NOTIFICATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {NOTIFICATION_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <input
          style={inputStyle}
          placeholder="Customer user ID…"
          value={userId}
          onChange={(e) => { setUserId(e.target.value); setPage(1); }}
        />
        <input style={inputStyle} type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} />
        <input style={inputStyle} type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} />
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Customer</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Channel</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Read</th>
              <th style={thStyle}>Attempts</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && <TableSkeleton columns={columnCount} />}
            {listQuery.isError && <ErrorState columns={columnCount} message="Failed to load notifications. Please try again." />}
            {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
              <EmptyState columns={columnCount} message="No notifications found." />
            )}
            {items.map((notification) => {
              const customer = customerLabel(notification);
              return (
                <tr key={notification.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(notification)}>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>{new Date(notification.createdAt).toLocaleString()}</td>
                  <td style={tdStyle}>
                    <div>{customer.name}</div>
                    {customer.name !== customer.email && (
                      <div style={{ fontSize: 12, color: '#9ca3af' }}>{customer.email}</div>
                    )}
                  </td>
                  <td style={tdStyle}>{NOTIFICATION_TYPE_LABELS[notification.type]}</td>
                  <td style={tdStyle}>{NOTIFICATION_CHANNEL_LABELS[notification.channel]}</td>
                  <td style={tdStyle}>
                    <DeliveryStatusBadge status={notification.status} />
                  </td>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>
                    {notification.channel === 'IN_APP' ? (notification.readAt ? 'Yes' : 'No') : '—'}
                  </td>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>{notification.attempts}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > 0 && <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />}

      {detail && (
        <Modal title="Notification details" onClose={() => setDetail(null)} width={560}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
            <div>
              <strong>{customerLabel(detail).name}</strong>
              <div style={{ fontSize: 12, color: '#9ca3af' }}>{detail.user.email}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <DeliveryStatusBadge status={detail.status} />
              <span style={{ fontSize: 13, color: '#374151' }}>{NOTIFICATION_TYPE_LABELS[detail.type]}</span>
              <span style={{ fontSize: 13, color: '#6b7280' }}>{NOTIFICATION_CHANNEL_LABELS[detail.channel]}</span>
            </div>
            <div style={{ fontWeight: 600 }}>{detail.title}</div>
            <div style={{ whiteSpace: 'pre-wrap', color: '#374151' }}>{detail.message}</div>
            {detail.lastError && (
              <div style={{ fontSize: 13, color: '#dc2626', background: '#fef2f2', padding: 10, borderRadius: 6 }}>
                Failure reason: {detail.lastError}
              </div>
            )}
            <div style={{ fontSize: 12, color: '#9ca3af' }}>Attempts: {detail.attempts}</div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>
              Created {new Date(detail.createdAt).toLocaleString()} · Updated{' '}
              {new Date(detail.updatedAt).toLocaleString()}
              {detail.sentAt && <> · Sent {new Date(detail.sentAt).toLocaleString()}</>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
