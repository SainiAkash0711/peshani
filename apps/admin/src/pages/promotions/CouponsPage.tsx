import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { Pagination } from '../../components/Pagination';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/TableStates';
import { pageHeaderStyle, tableStyle, tdStyle, thStyle, toolbarStyle, inputStyle, cardStyle } from '../../styles';
import { PaginatedResult } from '../../types/catalog';
import { CouponSummary, PromotionSummary } from '../../types/promotions';
import { CouponEditTarget, CouponFormModal, CouponFormValues } from './CouponFormModal';

const PAGE_SIZE = 20;

export function CouponsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('');
  const [formState, setFormState] = useState<'create' | CouponEditTarget | null>(null);
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CouponSummary | null>(null);
  const [pendingDeactivate, setPendingDeactivate] = useState<CouponSummary | null>(null);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  if (search) params.set('search', search);
  if (status) params.set('status', status);

  const listQuery = useQuery({
    queryKey: ['coupons', 'list', page, search, status],
    queryFn: () => apiClient.get<PaginatedResult<CouponSummary>>(`/coupons?${params.toString()}`),
  });

  const items = listQuery.data?.items ?? [];
  const pagination = listQuery.data?.pagination;

  // Coupons only carry a promotionId - resolve each unique one to a name for
  // display via the promotion detail endpoint, cached per id so paging back
  // and forth doesn't re-fetch.
  const uniquePromotionIds = useMemo(() => Array.from(new Set(items.map((c) => c.promotionId))), [items]);
  const promotionQueries = useQueries({
    queries: uniquePromotionIds.map((id) => ({
      queryKey: ['promotions', 'detail', id],
      queryFn: () => apiClient.get<PromotionSummary>(`/promotions/${id}`),
      staleTime: 5 * 60 * 1000,
    })),
  });
  const promotionNameById = useMemo(() => {
    const map = new Map<string, string>();
    uniquePromotionIds.forEach((id, index) => {
      const data = promotionQueries[index]?.data;
      if (data) map.set(id, data.name);
    });
    return map;
  }, [uniquePromotionIds, promotionQueries]);

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: ['coupons'] });
  }

  const createMutation = useMutation({
    mutationFn: (values: CouponFormValues) => apiClient.post<CouponSummary>('/coupons', values),
    onSuccess: () => {
      toast.show('success', 'Coupon created');
      setFormState(null);
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to create coupon'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: CouponFormValues }) => {
      const { promotionId, ...rest } = values;
      void promotionId;
      return apiClient.patch<CouponSummary>(`/coupons/${id}`, rest);
    },
    onSuccess: () => {
      toast.show('success', 'Coupon updated');
      setFormState(null);
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to update coupon'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiClient.patch<CouponSummary>(`/coupons/${id}/status`, { isActive }),
    onSuccess: (_data, variables) => {
      toast.show('success', variables.isActive ? 'Coupon activated' : 'Coupon deactivated');
      setPendingDeactivate(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to update status');
      setPendingDeactivate(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<{ id: string }>(`/coupons/${id}`),
    onSuccess: () => {
      toast.show('success', 'Coupon deleted');
      setPendingDelete(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to delete coupon');
      setPendingDelete(null);
    },
  });

  async function handleFormSubmit(values: CouponFormValues) {
    if (formState === 'create') {
      await createMutation.mutateAsync(values);
    } else if (formState) {
      await updateMutation.mutateAsync({ id: formState.id, values });
    }
  }

  async function handleEdit(coupon: CouponSummary) {
    setLoadingEditId(coupon.id);
    try {
      const cachedName = promotionNameById.get(coupon.promotionId);
      const promotionName =
        cachedName ??
        (await queryClient.fetchQuery({
          queryKey: ['promotions', 'detail', coupon.promotionId],
          queryFn: () => apiClient.get<PromotionSummary>(`/promotions/${coupon.promotionId}`),
        })).name;
      setFormState({ ...coupon, promotionName });
    } catch (err) {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to load coupon');
    } finally {
      setLoadingEditId(null);
    }
  }

  function handleToggleStatus(coupon: CouponSummary) {
    if (coupon.isActive) {
      setPendingDeactivate(coupon);
    } else {
      statusMutation.mutate({ id: coupon.id, isActive: true });
    }
  }

  function formatDateRange(coupon: CouponSummary): string {
    if (!coupon.startsAt && !coupon.endsAt) return '—';
    const start = coupon.startsAt ? new Date(coupon.startsAt).toLocaleDateString() : '…';
    const end = coupon.endsAt ? new Date(coupon.endsAt).toLocaleDateString() : '…';
    return `${start} – ${end}`;
  }

  const columnCount = 6;

  return (
    <div>
      <div style={pageHeaderStyle}>
        <div>
          <Link to="/promotions">
            <Button variant="secondary" style={{ marginBottom: 10 }}>
              ← Back to Promotions
            </Button>
          </Link>
          <h1 style={{ fontSize: 22, margin: 0 }}>Coupons</h1>
        </div>
        <Button onClick={() => setFormState('create')}>+ New Coupon</Button>
      </div>

      <div style={toolbarStyle}>
        <input
          style={inputStyle}
          placeholder="Search by code…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select style={inputStyle} value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Code</th>
              <th style={thStyle}>Promotion</th>
              <th style={thStyle}>Usage</th>
              <th style={thStyle}>Valid dates</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && <TableSkeleton columns={columnCount} />}
            {listQuery.isError && <ErrorState columns={columnCount} message="Failed to load coupons. Please try again." />}
            {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
              <EmptyState columns={columnCount} message="No coupons found." />
            )}
            {items.map((coupon) => (
              <tr key={coupon.id}>
                <td style={{ ...tdStyle, fontWeight: 500 }}>{coupon.code}</td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{promotionNameById.get(coupon.promotionId) ?? '…'}</td>
                <td style={tdStyle}>
                  {coupon.usageCount}
                  {coupon.usageLimit != null ? ` / ${coupon.usageLimit}` : ''}
                </td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{formatDateRange(coupon)}</td>
                <td style={tdStyle}>
                  <StatusBadge isActive={coupon.isActive} />
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Button
                      variant="secondary"
                      disabled={loadingEditId === coupon.id}
                      onClick={() => void handleEdit(coupon)}
                    >
                      {loadingEditId === coupon.id ? 'Loading…' : 'Edit'}
                    </Button>
                    <Button variant="secondary" onClick={() => handleToggleStatus(coupon)}>
                      {coupon.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button variant="danger" onClick={() => setPendingDelete(coupon)}>
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

      {formState && (
        <CouponFormModal
          title={formState === 'create' ? 'New Coupon' : `Edit ${formState.code}`}
          initial={formState === 'create' ? undefined : formState}
          onSubmit={handleFormSubmit}
          onClose={() => setFormState(null)}
        />
      )}

      {pendingDeactivate && (
        <ConfirmDialog
          title="Deactivate coupon"
          message={`Deactivate "${pendingDeactivate.code}"? Customers will no longer be able to redeem it.`}
          danger
          confirmLabel="Deactivate"
          isBusy={statusMutation.isPending}
          onConfirm={() => statusMutation.mutate({ id: pendingDeactivate.id, isActive: false })}
          onCancel={() => setPendingDeactivate(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete coupon"
          message={`Delete "${pendingDelete.code}"? This cannot be undone.`}
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
