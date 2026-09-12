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
import { Brand, PaginatedResult } from '../../types/catalog';
import { BrandFormModal, BrandFormValues } from './BrandFormModal';

const PAGE_SIZE = 20;

export function BrandsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('');
  const [formState, setFormState] = useState<'create' | Brand | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Brand | null>(null);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  if (search) params.set('search', search);
  if (status) params.set('status', status);

  const listQuery = useQuery({
    queryKey: ['brands', 'list', page, search, status],
    queryFn: () => apiClient.get<PaginatedResult<Brand>>(`/brands?${params.toString()}`),
  });

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: ['brands'] });
  }

  const createMutation = useMutation({
    mutationFn: (values: BrandFormValues) => apiClient.post<Brand>('/brands', values),
    onSuccess: () => {
      toast.show('success', 'Brand created');
      setFormState(null);
      invalidateAll();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: BrandFormValues }) =>
      apiClient.patch<Brand>(`/brands/${id}`, values),
    onSuccess: () => {
      toast.show('success', 'Brand updated');
      setFormState(null);
      invalidateAll();
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiClient.patch<Brand>(`/brands/${id}/status`, { isActive }),
    onSuccess: (_data, variables) => {
      toast.show('success', variables.isActive ? 'Brand activated' : 'Brand deactivated');
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to update status'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<{ id: string }>(`/brands/${id}`),
    onSuccess: () => {
      toast.show('success', 'Brand deleted');
      setPendingDelete(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to delete brand');
      setPendingDelete(null);
    },
  });

  async function handleFormSubmit(values: BrandFormValues) {
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
        <h1 style={{ fontSize: 22, margin: 0 }}>Brands</h1>
        <Button onClick={() => setFormState('create')}>+ New Brand</Button>
      </div>

      <div style={toolbarStyle}>
        <input
          style={inputStyle}
          placeholder="Search by name or slug…"
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
              <th style={thStyle}>Logo</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Slug</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && <TableSkeleton columns={columnCount} />}
            {listQuery.isError && <ErrorState columns={columnCount} message="Failed to load brands. Please try again." />}
            {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
              <EmptyState columns={columnCount} message="No brands found." />
            )}
            {items.map((brand) => (
              <tr key={brand.id}>
                <td style={tdStyle}>
                  {brand.logo ? (
                    <img src={brand.logo} alt={brand.name} style={{ height: 28, borderRadius: 4 }} />
                  ) : (
                    <span style={{ color: '#d1d5db' }}>—</span>
                  )}
                </td>
                <td style={tdStyle}>{brand.name}</td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{brand.slug}</td>
                <td style={tdStyle}>
                  <StatusBadge isActive={brand.isActive} />
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button variant="secondary" onClick={() => setFormState(brand)}>
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => statusMutation.mutate({ id: brand.id, isActive: !brand.isActive })}
                    >
                      {brand.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button variant="danger" onClick={() => setPendingDelete(brand)}>
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
        <BrandFormModal
          title={formState === 'create' ? 'New Brand' : `Edit ${formState.name}`}
          initial={formState === 'create' ? undefined : formState}
          onSubmit={handleFormSubmit}
          onClose={() => setFormState(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete brand"
          message={`Delete "${pendingDelete.name}"? This cannot be undone if no products are assigned to it.`}
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
