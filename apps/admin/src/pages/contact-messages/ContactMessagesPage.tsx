import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { Pagination } from '../../components/Pagination';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/TableStates';
import { pageHeaderStyle, tableStyle, tdStyle, thStyle, cardStyle } from '../../styles';
import { PaginatedResult } from '../../types/catalog';

const PAGE_SIZE = 20;

interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  createdAt: string;
  emailSentAt: string | null;
}

export function ContactMessagesPage() {
  const [page, setPage] = useState(1);

  const listQuery = useQuery({
    queryKey: ['contact-messages', page],
    queryFn: () => apiClient.get<PaginatedResult<ContactMessage>>(`/admin/contact-messages?page=${page}&pageSize=${PAGE_SIZE}`),
  });

  const items = listQuery.data?.items ?? [];
  const pagination = listQuery.data?.pagination;
  const columnCount = 5;

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Contact Messages</h1>
      </div>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20, marginTop: -12 }}>
        Submissions from the storefront&apos;s &quot;Email us&quot; form. Each one is also emailed to your Support email
        (see Store Settings) when that&apos;s configured.
      </p>

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>From</th>
              <th style={thStyle}>Phone</th>
              <th style={thStyle}>Message</th>
              <th style={thStyle}>Received</th>
              <th style={thStyle}>Emailed</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && <TableSkeleton columns={columnCount} />}
            {listQuery.isError && <ErrorState columns={columnCount} message="Failed to load contact messages. Please try again." />}
            {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
              <EmptyState columns={columnCount} message="No contact messages yet." />
            )}
            {items.map((msg) => (
              <tr key={msg.id}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600 }}>{msg.name}</div>
                  <div style={{ color: '#6b7280', fontSize: 12 }}>{msg.email}</div>
                </td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{msg.phone || '—'}</td>
                <td style={{ ...tdStyle, maxWidth: 360, whiteSpace: 'pre-wrap' }}>{msg.message}</td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{new Date(msg.createdAt).toLocaleString()}</td>
                <td style={tdStyle}>
                  {msg.emailSentAt ? (
                    <span style={{ color: '#15803d', fontSize: 12, fontWeight: 600 }}>Sent</span>
                  ) : (
                    <span style={{ color: '#9ca3af', fontSize: 12 }}>Not sent</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > 0 && (
        <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
      )}
    </div>
  );
}
