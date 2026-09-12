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
import { PaginatedResult, Warehouse } from '../../types/catalog';
import { WarehouseFormModal, WarehouseFormValues } from './WarehouseFormModal';

const PAGE_SIZE = 20;

export function WarehousesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('');
  const [formState, setFormState] = useState<'create' | Warehouse | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Warehouse | null>(null);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  if (search) params.set('search', search);
  if (status) params.set('status', status);

  const listQuery = useQuery({
    queryKey: ['warehouses', 'list', page, search, status],
    queryFn: () => apiClient.get<PaginatedResult<Warehouse>>(`/warehouses?${params.toString()}`),
  });

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: ['warehouses'] });
  }

  const createMutation = useMutation({
    mutationFn: (values: WarehouseFormValues) => apiClient.post<Warehouse>('/warehouses', values),
    onSuccess: () => {
      toast.show('success', 'Warehouse created');
      setFormState(null);
      invalidateAll();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: WarehouseFormValues }) =>
      apiClient.patch<Warehouse>(`/warehouses/${id}`, values),
    onSuccess: () => {
      toast.show('success', 'Warehouse updated');
      setFormState(null);
      invalidateAll();
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiClient.patch<Warehouse>(`/warehouses/${id}/status`, { isActive }),
    onSuccess: (_data, variables) => {
      toast.show('success', variables.isActive ? 'Warehouse activated' : 'Warehouse deactivated');
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to update status'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<{ id: string }>(`/warehouses/${id}`),
    onSuccess: () => {
      toast.show('success', 'Warehouse deleted');
      setPendingDelete(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to delete warehouse');
      setPendingDelete(null);
    },
  });

  async function handleFormSubmit(values: WarehouseFormValues) {
    if (formState === 'create') {
      await createMutation.mutateAsync(values);
    } else if (formState) {
      await updateMutation.mutateAsync({ id: formState.id, values });
    }
  }

  const items = listQuery.data?.items ?? [];
  const pagination = listQuery.data?.pagination;
  const columnCount = 5;

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Warehouses</h1>
        <Button onClick={() => setFormState('create')}>+ New Warehouse</Button>
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
              <th style={thStyle}>Location</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && <TableSkeleton columns={columnCount} />}
            {listQuery.isError && <ErrorState columns={columnCount} message="Failed to load warehouses. Please try again." />}
            {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
              <EmptyState columns={columnCount} message="No warehouses found." />
            )}
            {items.map((warehouse) => (
              <tr key={warehouse.id}>
                <td style={tdStyle}>
                  {warehouse.name}
                  {warehouse.isDefault && <span style={{ marginLeft: 6, fontSize: 11, color: '#4f46e5' }}>(default)</span>}
                </td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{warehouse.code}</td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{[warehouse.city, warehouse.country].filter(Boolean).join(', ') || '—'}</td>
                <td style={tdStyle}>
                  <StatusBadge isActive={warehouse.isActive} />
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button variant="secondary" onClick={() => setFormState(warehouse)}>
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => statusMutation.mutate({ id: warehouse.id, isActive: !warehouse.isActive })}
                    >
                      {warehouse.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button variant="danger" onClick={() => setPendingDelete(warehouse)}>
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
        <WarehouseFormModal
          title={formState === 'create' ? 'New Warehouse' : `Edit ${formState.name}`}
          initial={formState === 'create' ? undefined : formState}
          onSubmit={handleFormSubmit}
          onClose={() => setFormState(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete warehouse"
          message={`Delete "${pendingDelete.name}"? This cannot be undone if it holds stock or active reservations.`}
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
