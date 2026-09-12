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
import { Attribute, PaginatedResult } from '../../types/catalog';
import { AttributeFormModal, AttributeFormValues } from './AttributeFormModal';
import { AttributeValuesModal } from './AttributeValuesModal';

const PAGE_SIZE = 20;

export function AttributesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('');
  const [formState, setFormState] = useState<'create' | Attribute | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Attribute | null>(null);
  const [managingValuesFor, setManagingValuesFor] = useState<Attribute | null>(null);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  if (search) params.set('search', search);
  if (status) params.set('status', status);

  const listQuery = useQuery({
    queryKey: ['attributes', 'list', page, search, status],
    queryFn: () => apiClient.get<PaginatedResult<Attribute>>(`/attributes?${params.toString()}`),
  });

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: ['attributes'] });
  }

  const createMutation = useMutation({
    mutationFn: (values: AttributeFormValues) => apiClient.post<Attribute>('/attributes', values),
    onSuccess: () => {
      toast.show('success', 'Attribute created');
      setFormState(null);
      invalidateAll();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: AttributeFormValues }) =>
      apiClient.patch<Attribute>(`/attributes/${id}`, values),
    onSuccess: () => {
      toast.show('success', 'Attribute updated');
      setFormState(null);
      invalidateAll();
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiClient.patch<Attribute>(`/attributes/${id}/status`, { isActive }),
    onSuccess: (_data, variables) => {
      toast.show('success', variables.isActive ? 'Attribute activated' : 'Attribute deactivated');
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to update status'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<{ id: string }>(`/attributes/${id}`),
    onSuccess: () => {
      toast.show('success', 'Attribute deleted');
      setPendingDelete(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to delete attribute');
      setPendingDelete(null);
    },
  });

  async function handleFormSubmit(values: AttributeFormValues) {
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
        <h1 style={{ fontSize: 22, margin: 0 }}>Attributes</h1>
        <Button onClick={() => setFormState('create')}>+ New Attribute</Button>
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
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Order</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && <TableSkeleton columns={columnCount} />}
            {listQuery.isError && <ErrorState columns={columnCount} message="Failed to load attributes. Please try again." />}
            {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
              <EmptyState columns={columnCount} message="No attributes found." />
            )}
            {items.map((attribute) => (
              <tr key={attribute.id}>
                <td style={tdStyle}>{attribute.name}</td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{attribute.type}</td>
                <td style={tdStyle}>
                  <StatusBadge isActive={attribute.isActive} />
                </td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{attribute.sortOrder}</td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Button variant="secondary" onClick={() => setManagingValuesFor(attribute)}>
                      Values
                    </Button>
                    <Button variant="secondary" onClick={() => setFormState(attribute)}>
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => statusMutation.mutate({ id: attribute.id, isActive: !attribute.isActive })}
                    >
                      {attribute.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button variant="danger" onClick={() => setPendingDelete(attribute)}>
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
        <AttributeFormModal
          title={formState === 'create' ? 'New Attribute' : `Edit ${formState.name}`}
          initial={formState === 'create' ? undefined : formState}
          onSubmit={handleFormSubmit}
          onClose={() => setFormState(null)}
        />
      )}

      {managingValuesFor && (
        <AttributeValuesModal attribute={managingValuesFor} onClose={() => setManagingValuesFor(null)} />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete attribute"
          message={`Delete "${pendingDelete.name}"? This cannot be undone if it's used by any product or variant.`}
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
