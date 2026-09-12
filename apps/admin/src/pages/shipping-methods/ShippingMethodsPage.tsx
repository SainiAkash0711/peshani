import { useState } from 'react';
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
import { ShippingMethod } from '../../types/orders';
import { ShippingMethodFormModal, ShippingMethodFormValues } from './ShippingMethodFormModal';

const PAGE_SIZE = 20;

export function ShippingMethodsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('');
  const [formState, setFormState] = useState<'create' | ShippingMethod | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ShippingMethod | null>(null);
  const [pendingDeactivate, setPendingDeactivate] = useState<ShippingMethod | null>(null);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  if (search) params.set('search', search);
  if (status) params.set('status', status);

  const listQuery = useQuery({
    queryKey: ['shipping-methods', 'list', page, search, status],
    queryFn: () => apiClient.get<PaginatedResult<ShippingMethod>>(`/shipping-methods?${params.toString()}`),
  });

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: ['shipping-methods'] });
  }

  const createMutation = useMutation({
    mutationFn: (values: ShippingMethodFormValues) => apiClient.post<ShippingMethod>('/shipping-methods', values),
    onSuccess: () => {
      toast.show('success', 'Shipping method created');
      setFormState(null);
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to create shipping method'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ShippingMethodFormValues }) =>
      apiClient.patch<ShippingMethod>(`/shipping-methods/${id}`, values),
    onSuccess: () => {
      toast.show('success', 'Shipping method updated');
      setFormState(null);
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to update shipping method'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiClient.patch<ShippingMethod>(`/shipping-methods/${id}/status`, { isActive }),
    onSuccess: (_data, variables) => {
      toast.show('success', variables.isActive ? 'Shipping method activated' : 'Shipping method deactivated');
      setPendingDeactivate(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to update status');
      setPendingDeactivate(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<{ id: string }>(`/shipping-methods/${id}`),
    onSuccess: () => {
      toast.show('success', 'Shipping method deleted');
      setPendingDelete(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to delete shipping method');
      setPendingDelete(null);
    },
  });

  async function handleFormSubmit(values: ShippingMethodFormValues) {
    if (formState === 'create') {
      await createMutation.mutateAsync(values);
    } else if (formState) {
      await updateMutation.mutateAsync({ id: formState.id, values });
    }
  }

  function handleToggleStatus(method: ShippingMethod) {
    if (method.isActive) {
      setPendingDeactivate(method);
    } else {
      statusMutation.mutate({ id: method.id, isActive: true });
    }
  }

  const items = listQuery.data?.items ?? [];
  const pagination = listQuery.data?.pagination;
  const columnCount = 6;

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Shipping Methods</h1>
        <Button onClick={() => setFormState('create')}>+ New Shipping Method</Button>
      </div>

      <div style={toolbarStyle}>
        <input
          style={inputStyle}
          placeholder="Search by name or code…"
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
              <th style={thStyle}>Code</th>
              <th style={thStyle}>Price</th>
              <th style={thStyle}>Est. delivery</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && <TableSkeleton columns={columnCount} />}
            {listQuery.isError && <ErrorState columns={columnCount} message="Failed to load shipping methods. Please try again." />}
            {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
              <EmptyState columns={columnCount} message="No shipping methods found." />
            )}
            {items.map((method) => (
              <tr key={method.id}>
                <td style={tdStyle}>{method.name}</td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{method.code}</td>
                <td style={tdStyle}>{method.price}</td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>
                  {method.estimatedDeliveryDays != null ? `${method.estimatedDeliveryDays} day(s)` : '—'}
                </td>
                <td style={tdStyle}>
                  <StatusBadge isActive={method.isActive} />
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button variant="secondary" onClick={() => setFormState(method)}>
                      Edit
                    </Button>
                    <Button variant="secondary" onClick={() => handleToggleStatus(method)}>
                      {method.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button variant="danger" onClick={() => setPendingDelete(method)}>
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
        <ShippingMethodFormModal
          title={formState === 'create' ? 'New Shipping Method' : `Edit ${formState.name}`}
          initial={formState === 'create' ? undefined : formState}
          onSubmit={handleFormSubmit}
          onClose={() => setFormState(null)}
        />
      )}

      {pendingDeactivate && (
        <ConfirmDialog
          title="Deactivate shipping method"
          message={`Deactivate "${pendingDeactivate.name}"? Customers will no longer be able to select it at checkout.`}
          danger
          confirmLabel="Deactivate"
          isBusy={statusMutation.isPending}
          onConfirm={() => statusMutation.mutate({ id: pendingDeactivate.id, isActive: false })}
          onCancel={() => setPendingDeactivate(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete shipping method"
          message={`Delete "${pendingDelete.name}"? This cannot be undone.`}
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
