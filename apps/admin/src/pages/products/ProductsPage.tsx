import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { Pagination } from '../../components/Pagination';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/TableStates';
import { pageHeaderStyle, tableStyle, tdStyle, thStyle, toolbarStyle, inputStyle, cardStyle } from '../../styles';
import { PaginatedResult, ProductSummary } from '../../types/catalog';

const PAGE_SIZE = 20;

export function ProductsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ProductSummary | null>(null);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (type) params.set('type', type);

  const listQuery = useQuery({
    queryKey: ['products', 'list', page, search, status, type],
    queryFn: () => apiClient.get<PaginatedResult<ProductSummary>>(`/products?${params.toString()}`),
  });

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: ['products'] });
  }

  const statusMutation = useMutation({
    mutationFn: ({ id, newStatus }: { id: string; newStatus: string }) =>
      apiClient.patch(`/products/${id}/status`, { status: newStatus }),
    onSuccess: () => {
      toast.show('success', 'Status updated');
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to update status'),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => apiClient.post<ProductSummary>(`/products/${id}/duplicate`),
    onSuccess: (product) => {
      toast.show('success', 'Product duplicated');
      invalidateAll();
      navigate(`/products/${product.id}/edit`);
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to duplicate product'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<{ id: string }>(`/products/${id}`),
    onSuccess: () => {
      toast.show('success', 'Product deleted');
      setPendingDelete(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to delete product');
      setPendingDelete(null);
    },
  });

  const items = listQuery.data?.items ?? [];
  const pagination = listQuery.data?.pagination;
  const columnCount = 8;

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Products</h1>
        <Button onClick={() => navigate('/products/new')}>+ New Product</Button>
      </div>

      <div style={toolbarStyle}>
        <input
          style={inputStyle}
          placeholder="Search by name, slug, SKU, barcode…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select style={inputStyle} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        <select style={inputStyle} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">All types</option>
          <option value="SIMPLE">Simple</option>
          <option value="VARIABLE">Variable</option>
        </select>
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Product</th>
              <th style={thStyle}>SKU</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Brand</th>
              <th style={thStyle}>Price</th>
              <th style={thStyle}>Variants</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && <TableSkeleton columns={columnCount} />}
            {listQuery.isError && <ErrorState columns={columnCount} message="Failed to load products. Please try again." />}
            {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
              <EmptyState columns={columnCount} message="No products found." />
            )}
            {items.map((product) => (
              <tr key={product.id}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 500 }}>{product.name}</div>
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>{product.slug}</div>
                </td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{product.sku ?? '—'}</td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{product.productType}</td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{product.brand?.name ?? '—'}</td>
                <td style={tdStyle}>₹{product.basePrice}</td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{product.productType === 'VARIABLE' ? product.variantCount : '—'}</td>
                <td style={tdStyle}>
                  <StatusBadge isActive={product.status === 'ACTIVE'} />
                  {product.status !== 'ACTIVE' && (
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{product.status}</div>
                  )}
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Button variant="secondary" onClick={() => navigate(`/products/${product.id}/edit`)}>
                      Edit
                    </Button>
                    <Button variant="secondary" onClick={() => duplicateMutation.mutate(product.id)}>
                      Duplicate
                    </Button>
                    {product.status === 'DRAFT' && (
                      <Button variant="secondary" onClick={() => statusMutation.mutate({ id: product.id, newStatus: 'ACTIVE' })}>
                        Activate
                      </Button>
                    )}
                    {product.status === 'ACTIVE' && (
                      <Button variant="secondary" onClick={() => statusMutation.mutate({ id: product.id, newStatus: 'INACTIVE' })}>
                        Deactivate
                      </Button>
                    )}
                    {product.status === 'INACTIVE' && (
                      <Button variant="secondary" onClick={() => statusMutation.mutate({ id: product.id, newStatus: 'ACTIVE' })}>
                        Activate
                      </Button>
                    )}
                    <Button variant="danger" onClick={() => setPendingDelete(product)}>
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
          title="Delete product"
          message={`Delete "${pendingDelete.name}"? This cannot be undone if it has inventory records.`}
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
