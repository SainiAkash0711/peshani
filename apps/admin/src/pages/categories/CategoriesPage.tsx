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
import { Category, PaginatedResult } from '../../types/catalog';
import { CategoryFormModal, CategoryFormValues } from './CategoryFormModal';

const PAGE_SIZE = 20;

// Top-level categories only - subcategories have their own dedicated page
// (Subcategories), so this list is never mixed with them. Same underlying
// Category API/model either way (see CategoryFormModal's own comment) -
// this page just always filters to `rootOnly=true` and always creates
// with parentId: null.
export function CategoriesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('');
  const [formState, setFormState] = useState<'create' | Category | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);

  const listParams = new URLSearchParams();
  listParams.set('page', String(page));
  listParams.set('pageSize', String(PAGE_SIZE));
  listParams.set('rootOnly', 'true');
  if (search) listParams.set('search', search);
  if (status) listParams.set('status', status);

  const listQuery = useQuery({
    queryKey: ['categories', 'top-level', page, search, status],
    queryFn: () => apiClient.get<PaginatedResult<Category>>(`/categories?${listParams.toString()}`),
  });

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: ['categories'] });
  }

  const createMutation = useMutation({
    mutationFn: (values: CategoryFormValues) => apiClient.post<Category>('/categories', values),
    onSuccess: () => {
      toast.show('success', 'Category created');
      setFormState(null);
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to create category'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: CategoryFormValues }) =>
      apiClient.patch<Category>(`/categories/${id}`, values),
    onSuccess: () => {
      toast.show('success', 'Category updated');
      setFormState(null);
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to update category'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiClient.patch<Category>(`/categories/${id}/status`, { isActive }),
    onSuccess: (_data, variables) => {
      toast.show('success', variables.isActive ? 'Category activated' : 'Category deactivated');
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to update status'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<{ id: string }>(`/categories/${id}`),
    onSuccess: () => {
      toast.show('success', 'Category deleted');
      setPendingDelete(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to delete category (it may still have subcategories or products)');
      setPendingDelete(null);
    },
  });

  async function handleFormSubmit(values: CategoryFormValues) {
    if (formState === 'create') {
      await createMutation.mutateAsync(values);
    } else if (formState) {
      await updateMutation.mutateAsync({ id: formState.id, values });
    }
  }

  const items = listQuery.data?.items ?? [];
  const pagination = listQuery.data?.pagination;
  const columnCount = 6;

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Categories</h1>
        <Button onClick={() => setFormState('create')}>+ Add Category</Button>
      </div>

      <div style={toolbarStyle}>
        <input
          style={inputStyle}
          placeholder="Search by name or slug…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select
          style={inputStyle}
          value={status}
          onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}
        >
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
              <th style={thStyle}>Slug</th>
              <th style={thStyle}>Subcategories</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Updated</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && <TableSkeleton columns={columnCount} />}
            {listQuery.isError && <ErrorState columns={columnCount} message="Failed to load categories. Please try again." />}
            {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
              <EmptyState columns={columnCount} message="No categories found." />
            )}
            {items.map((category) => (
              <tr key={category.id}>
                <td style={tdStyle}>{category.name}</td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{category.slug}</td>
                <td style={tdStyle}>{category.subcategoryCount ?? 0}</td>
                <td style={tdStyle}>
                  <StatusBadge isActive={category.isActive} />
                </td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{new Date(category.updatedAt).toLocaleDateString()}</td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button variant="secondary" onClick={() => setFormState(category)}>
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => statusMutation.mutate({ id: category.id, isActive: !category.isActive })}
                    >
                      {category.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button variant="danger" onClick={() => setPendingDelete(category)}>
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
        <CategoryFormModal
          title={formState === 'create' ? 'Add Category' : `Edit ${formState.name}`}
          mode="category"
          initial={formState === 'create' ? undefined : formState}
          tree={[]}
          onSubmit={handleFormSubmit}
          onClose={() => setFormState(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete category"
          message={`Delete "${pendingDelete.name}"? This cannot be undone if it has no subcategories or products.`}
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
