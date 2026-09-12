import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Pagination } from '../../components/Pagination';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/TableStates';
import { pageHeaderStyle, tableStyle, tdStyle, thStyle, toolbarStyle, inputStyle, cardStyle } from '../../styles';
import { PaginatedResult } from '../../types/catalog';
import { AdminReview, ReviewStatus } from '../../types/reviews';

const PAGE_SIZE = 20;

const STATUSES: ReviewStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'HIDDEN'];

const STATUS_STYLES: Record<ReviewStatus, { background: string; color: string }> = {
  PENDING: { background: '#fef9c3', color: '#a16207' },
  APPROVED: { background: '#dcfce7', color: '#15803d' },
  REJECTED: { background: '#fee2e2', color: '#dc2626' },
  HIDDEN: { background: '#f3f4f6', color: '#6b7280' },
};

function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
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

function Stars({ rating }: { rating: number }) {
  return (
    <span style={{ color: '#f59e0b', letterSpacing: 1, fontSize: 14 }} title={`${rating} / 5`}>
      {'★'.repeat(rating)}
      <span style={{ color: '#e5e7eb' }}>{'★'.repeat(5 - rating)}</span>
    </span>
  );
}

interface ModerationRequest {
  review: AdminReview;
  status: 'APPROVED' | 'REJECTED' | 'HIDDEN';
}

export function ReviewsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'' | ReviewStatus>('');
  const [rating, setRating] = useState<'' | string>('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [detailReview, setDetailReview] = useState<AdminReview | null>(null);
  const [moderationRequest, setModerationRequest] = useState<ModerationRequest | null>(null);
  const [moderationNote, setModerationNote] = useState('');
  const [pendingDelete, setPendingDelete] = useState<AdminReview | null>(null);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  if (status) params.set('status', status);
  if (rating) params.set('rating', rating);
  if (verifiedOnly) params.set('verifiedPurchase', 'true');

  const listQuery = useQuery({
    queryKey: ['admin-reviews', 'list', page, status, rating, verifiedOnly],
    queryFn: () => apiClient.get<PaginatedResult<AdminReview>>(`/admin/reviews?${params.toString()}`),
  });

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });
  }

  const moderateMutation = useMutation({
    mutationFn: ({ id, status: newStatus, moderationNote: note }: { id: string; status: ReviewStatus; moderationNote?: string }) =>
      apiClient.patch<AdminReview>(`/admin/reviews/${id}/moderate`, { status: newStatus, moderationNote: note || undefined }),
    onSuccess: (updated) => {
      toast.show('success', `Review ${updated.status.toLowerCase()}`);
      setModerationRequest(null);
      setModerationNote('');
      setDetailReview(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to update review status');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<{ id: string }>(`/admin/reviews/${id}`),
    onSuccess: () => {
      toast.show('success', 'Review deleted');
      setPendingDelete(null);
      setDetailReview(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to delete review');
      setPendingDelete(null);
    },
  });

  const items = listQuery.data?.items ?? [];
  const pagination = listQuery.data?.pagination;
  const columnCount = 7;

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Reviews</h1>
      </div>

      <div style={toolbarStyle}>
        <select style={inputStyle} value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select style={inputStyle} value={rating} onChange={(e) => { setRating(e.target.value); setPage(1); }}>
          <option value="">All ratings</option>
          {[5, 4, 3, 2, 1].map((r) => (
            <option key={r} value={r}>
              {r} star{r > 1 ? 's' : ''}
            </option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#374151' }}>
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(e) => { setVerifiedOnly(e.target.checked); setPage(1); }}
          />
          Verified purchases only
        </label>
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Product</th>
              <th style={thStyle}>Customer</th>
              <th style={thStyle}>Rating</th>
              <th style={thStyle}>Title</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Verified</th>
              <th style={thStyle}>Date</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && <TableSkeleton columns={columnCount} />}
            {listQuery.isError && <ErrorState columns={columnCount} message="Failed to load reviews. Please try again." />}
            {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
              <EmptyState columns={columnCount} message="No reviews found." />
            )}
            {items.map((review) => (
              <tr key={review.id} style={{ cursor: 'pointer' }} onClick={() => setDetailReview(review)}>
                <td style={tdStyle}>{review.productName}</td>
                <td style={tdStyle}>
                  <div>{review.customerName}</div>
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>{review.customerEmail}</div>
                </td>
                <td style={tdStyle}>
                  <Stars rating={review.rating} />
                </td>
                <td style={{ ...tdStyle, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {review.title || '—'}
                </td>
                <td style={tdStyle}>
                  <ReviewStatusBadge status={review.status} />
                </td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{review.verifiedPurchase ? 'Yes' : 'No'}</td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{new Date(review.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > 0 && (
        <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
      )}

      {detailReview && (
        <Modal title="Review details" onClose={() => setDetailReview(null)} width={560}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
            <div>
              <strong>{detailReview.productName}</strong>
            </div>
            <div style={{ color: '#6b7280' }}>
              {detailReview.customerName} ({detailReview.customerEmail})
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Stars rating={detailReview.rating} />
              <ReviewStatusBadge status={detailReview.status} />
              {detailReview.verifiedPurchase && (
                <span style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>Verified purchase</span>
              )}
            </div>
            {detailReview.title && <div style={{ fontWeight: 600 }}>{detailReview.title}</div>}
            <div style={{ whiteSpace: 'pre-wrap', color: '#374151' }}>{detailReview.body}</div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>
              Submitted {new Date(detailReview.createdAt).toLocaleString()}
              {detailReview.moderatedAt && (
                <> · Moderated {new Date(detailReview.moderatedAt).toLocaleString()}</>
              )}
            </div>
            {detailReview.moderationNote && (
              <div style={{ fontSize: 13, color: '#6b7280', background: '#f9fafb', padding: 10, borderRadius: 6 }}>
                Moderation note: {detailReview.moderationNote}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <Button
                variant="secondary"
                disabled={detailReview.status === 'APPROVED'}
                onClick={() => setModerationRequest({ review: detailReview, status: 'APPROVED' })}
              >
                Approve
              </Button>
              <Button
                variant="secondary"
                disabled={detailReview.status === 'REJECTED'}
                onClick={() => setModerationRequest({ review: detailReview, status: 'REJECTED' })}
              >
                Reject
              </Button>
              <Button
                variant="secondary"
                disabled={detailReview.status === 'HIDDEN'}
                onClick={() => setModerationRequest({ review: detailReview, status: 'HIDDEN' })}
              >
                Hide
              </Button>
              <Button variant="danger" onClick={() => setPendingDelete(detailReview)}>
                Delete
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {moderationRequest && (
        <Modal
          title={`${moderationRequest.status === 'APPROVED' ? 'Approve' : moderationRequest.status === 'REJECTED' ? 'Reject' : 'Hide'} review`}
          onClose={() => { setModerationRequest(null); setModerationNote(''); }}
          width={420}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Moderation note (optional)</label>
            <textarea
              style={{ padding: '8px 10px', fontSize: 14, border: '1px solid #d1d5db', borderRadius: 6, fontFamily: 'inherit' }}
              rows={3}
              value={moderationNote}
              onChange={(e) => setModerationNote(e.target.value)}
              placeholder="Reason visible to other admins…"
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="secondary" disabled={moderateMutation.isPending} onClick={() => { setModerationRequest(null); setModerationNote(''); }}>
                Cancel
              </Button>
              <Button
                disabled={moderateMutation.isPending}
                onClick={() =>
                  moderateMutation.mutate({
                    id: moderationRequest.review.id,
                    status: moderationRequest.status,
                    moderationNote,
                  })
                }
              >
                {moderateMutation.isPending ? 'Please wait…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete review"
          message={`Delete this review by "${pendingDelete.customerName}" for "${pendingDelete.productName}"? This cannot be undone.`}
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
