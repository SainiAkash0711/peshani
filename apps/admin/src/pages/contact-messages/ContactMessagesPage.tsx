import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { Pagination } from '../../components/Pagination';
import { ConfirmDialog } from '../../components/ConfirmDialog';
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
  replyCount: number;
}

export function ContactMessagesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState<ContactMessage | null>(null);

  const listQuery = useQuery({
    queryKey: ['contact-messages', page],
    queryFn: () => apiClient.get<PaginatedResult<ContactMessage>>(`/admin/contact-messages?page=${page}&pageSize=${PAGE_SIZE}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<{ id: string }>(`/admin/contact-messages/${id}`),
    onSuccess: () => {
      toast.show('success', 'Message deleted');
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['contact-messages'] });
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to delete message');
      setPendingDelete(null);
    },
  });

  const items = listQuery.data?.items ?? [];
  const pagination = listQuery.data?.pagination;
  const columnCount = 6;

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Contact Messages</h1>
      </div>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20, marginTop: -12 }}>
        Submissions from the storefront&apos;s &quot;Email us&quot; form. Each one is also emailed to your Support email
        (see Store Settings) when that&apos;s configured. Click a message to reply.
      </p>

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>From</th>
              <th style={thStyle}>Phone</th>
              <th style={thStyle}>Message</th>
              <th style={thStyle}>Received</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && <TableSkeleton columns={columnCount} />}
            {listQuery.isError && <ErrorState columns={columnCount} message="Failed to load contact messages. Please try again." />}
            {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
              <EmptyState columns={columnCount} message="No contact messages yet." />
            )}
            {items.map((msg) => (
              <tr key={msg.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/contact-messages/${msg.id}`)}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600 }}>{msg.name}</div>
                  <div style={{ color: '#6b7280', fontSize: 12 }}>{msg.email}</div>
                </td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{msg.phone || '—'}</td>
                <td style={{ ...tdStyle, maxWidth: 360, whiteSpace: 'pre-wrap' }}>{msg.message}</td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{new Date(msg.createdAt).toLocaleString()}</td>
                <td style={tdStyle}>
                  {msg.replyCount > 0 ? (
                    <span style={{ color: '#15803d', fontSize: 12, fontWeight: 600 }}>
                      Replied {msg.replyCount > 1 ? `(${msg.replyCount})` : ''}
                    </span>
                  ) : (
                    <span style={{ color: '#9ca3af', fontSize: 12 }}>Awaiting reply</span>
                  )}
                </td>
                <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button variant="secondary" onClick={() => navigate(`/contact-messages/${msg.id}`)}>
                      Reply
                    </Button>
                    <Button variant="danger" onClick={() => setPendingDelete(msg)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > 0 && (
        <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete message"
          message={`Delete the message from "${pendingDelete.name}"? This cannot be undone.`}
          danger
          confirmLabel="Delete"
          isBusy={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
