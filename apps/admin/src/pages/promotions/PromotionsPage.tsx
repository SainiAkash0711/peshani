import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { Pagination } from '../../components/Pagination';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/TableStates';
import { pageHeaderStyle, tableStyle, tdStyle, thStyle, toolbarStyle, inputStyle, cardStyle } from '../../styles';
import { PaginatedResult } from '../../types/catalog';
import { PromotionDetail, PromotionSummary } from '../../types/promotions';
import { formatDiscountLabel } from '../../lib/promotion-format';
import { hydratePromotionDetail, HydratedPromotion } from '../../lib/promotion-targeting';
import { PromotionFormModal, PromotionFormValues } from './PromotionFormModal';

const PAGE_SIZE = 20;

export function PromotionsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('');
  const [formState, setFormState] = useState<'create' | HydratedPromotion | null>(null);
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PromotionSummary | null>(null);
  const [pendingDeactivate, setPendingDeactivate] = useState<PromotionSummary | null>(null);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  if (search) params.set('search', search);
  if (status) params.set('status', status);

  const listQuery = useQuery({
    queryKey: ['promotions', 'list', page, search, status],
    queryFn: () => apiClient.get<PaginatedResult<PromotionSummary>>(`/promotions?${params.toString()}`),
  });

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: ['promotions'] });
  }

  const createMutation = useMutation({
    mutationFn: (values: PromotionFormValues) => apiClient.post<PromotionSummary>('/promotions', values),
    onSuccess: () => {
      toast.show('success', 'Promotion created');
      setFormState(null);
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to create promotion'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: PromotionFormValues }) =>
      apiClient.patch<PromotionSummary>(`/promotions/${id}`, values),
    onSuccess: () => {
      toast.show('success', 'Promotion updated');
      setFormState(null);
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to update promotion'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiClient.patch<PromotionSummary>(`/promotions/${id}/status`, { isActive }),
    onSuccess: (_data, variables) => {
      toast.show('success', variables.isActive ? 'Promotion activated' : 'Promotion deactivated');
      setPendingDeactivate(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to update status');
      setPendingDeactivate(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<{ id: string }>(`/promotions/${id}`),
    onSuccess: () => {
      toast.show('success', 'Promotion deleted');
      setPendingDelete(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to delete promotion');
      setPendingDelete(null);
    },
  });

  async function handleFormSubmit(values: PromotionFormValues) {
    if (formState === 'create') {
      await createMutation.mutateAsync(values);
    } else if (formState) {
      await updateMutation.mutateAsync({ id: formState.id, values });
    }
  }

  async function handleEdit(promotion: PromotionSummary) {
    setLoadingEditId(promotion.id);
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: ['promotions', 'detail', promotion.id],
        queryFn: () => apiClient.get<PromotionDetail>(`/promotions/${promotion.id}`),
      });
      const hydrated = await hydratePromotionDetail(detail);
      setFormState(hydrated);
    } catch (err) {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to load promotion');
    } finally {
      setLoadingEditId(null);
    }
  }

  function handleToggleStatus(promotion: PromotionSummary) {
    if (promotion.isActive) {
      setPendingDeactivate(promotion);
    } else {
      statusMutation.mutate({ id: promotion.id, isActive: true });
    }
  }

  const items = listQuery.data?.items ?? [];
  const pagination = listQuery.data?.pagination;
  const columnCount = 6;

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Promotions</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/coupons">
            <Button variant="secondary">Manage Coupons</Button>
          </Link>
          <Button onClick={() => setFormState('create')}>+ New Promotion</Button>
        </div>
      </div>

      <div style={toolbarStyle}>
        <input
          style={inputStyle}
          placeholder="Search by name…"
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
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Discount</th>
              <th style={thStyle}>Min. order</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Updated</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && <TableSkeleton columns={columnCount} />}
            {listQuery.isError && <ErrorState columns={columnCount} message="Failed to load promotions. Please try again." />}
            {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
              <EmptyState columns={columnCount} message="No promotions found." />
            )}
            {items.map((promotion) => (
              <tr key={promotion.id}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 500 }}>{promotion.name}</div>
                  {promotion.description && (
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>{promotion.description}</div>
                  )}
                </td>
                <td style={tdStyle}>{formatDiscountLabel(promotion)}</td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>
                  {promotion.minimumOrderAmount ? `₹${promotion.minimumOrderAmount}` : '—'}
                </td>
                <td style={tdStyle}>
                  <StatusBadge isActive={promotion.isActive} />
                </td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{new Date(promotion.updatedAt).toLocaleDateString()}</td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Button
                      variant="secondary"
                      disabled={loadingEditId === promotion.id}
                      onClick={() => void handleEdit(promotion)}
                    >
                      {loadingEditId === promotion.id ? 'Loading…' : 'Edit'}
                    </Button>
                    <Button variant="secondary" onClick={() => handleToggleStatus(promotion)}>
                      {promotion.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button variant="danger" onClick={() => setPendingDelete(promotion)}>
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
        <PromotionFormModal
          title={formState === 'create' ? 'New Promotion' : `Edit ${formState.name}`}
          initial={formState === 'create' ? undefined : formState}
          onSubmit={handleFormSubmit}
          onClose={() => setFormState(null)}
        />
      )}

      {pendingDeactivate && (
        <ConfirmDialog
          title="Deactivate promotion"
          message={`Deactivate "${pendingDeactivate.name}"? It will no longer apply to new orders.`}
          danger
          confirmLabel="Deactivate"
          isBusy={statusMutation.isPending}
          onConfirm={() => statusMutation.mutate({ id: pendingDeactivate.id, isActive: false })}
          onCancel={() => setPendingDeactivate(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete promotion"
          message={`Delete "${pendingDelete.name}"? This cannot be undone. Coupons attached to it will stop working.`}
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
