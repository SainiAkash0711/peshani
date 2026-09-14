import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { Pagination } from '../../components/Pagination';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/TableStates';
import { pageHeaderStyle, tableStyle, tdStyle, thStyle, toolbarStyle, inputStyle, cardStyle } from '../../styles';
import { BlogPost, BlogPostStatus, PaginatedResult } from '../../types/catalog';

const PAGE_SIZE = 20;

function StatusPill({ status }: { status: BlogPostStatus }) {
  const isPublished = status === 'PUBLISHED';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: isPublished ? '#dcfce7' : '#f3f4f6',
        color: isPublished ? '#15803d' : '#6b7280',
      }}
    >
      {isPublished ? 'Published' : 'Draft'}
    </span>
  );
}

export function BlogPostsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | BlogPostStatus>('');
  const [pendingDelete, setPendingDelete] = useState<BlogPost | null>(null);

  const listParams = new URLSearchParams();
  listParams.set('page', String(page));
  listParams.set('pageSize', String(PAGE_SIZE));
  if (search) listParams.set('search', search);
  if (status) listParams.set('status', status);

  const listQuery = useQuery({
    queryKey: ['blog-posts', page, search, status],
    queryFn: () => apiClient.get<PaginatedResult<BlogPost>>(`/admin/blog-posts?${listParams.toString()}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<{ id: string }>(`/admin/blog-posts/${id}`),
    onSuccess: () => {
      toast.show('success', 'Blog post deleted');
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['blog-posts'] });
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to delete blog post');
      setPendingDelete(null);
    },
  });

  const items = listQuery.data?.items ?? [];
  const pagination = listQuery.data?.pagination;
  const columnCount = 6;

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Blog</h1>
        <Button onClick={() => navigate('/blog/new')}>+ New Post</Button>
      </div>

      <div style={toolbarStyle}>
        <input
          style={inputStyle}
          placeholder="Search by title…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select
          style={inputStyle}
          value={status}
          onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}
        >
          <option value="">All statuses</option>
          <option value="PUBLISHED">Published</option>
          <option value="DRAFT">Draft</option>
        </select>
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Cover</th>
              <th style={thStyle}>Title</th>
              <th style={thStyle}>Tags</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Published</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && <TableSkeleton columns={columnCount} />}
            {listQuery.isError && <ErrorState columns={columnCount} message="Failed to load blog posts. Please try again." />}
            {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
              <EmptyState columns={columnCount} message="No blog posts yet - click “+ New Post” to write one." />
            )}
            {items.map((post) => (
              <tr key={post.id}>
                <td style={tdStyle}>
                  {post.coverImageUrl ? (
                    <img
                      src={post.coverImageUrl}
                      alt=""
                      style={{ width: 56, height: 40, objectFit: 'cover', borderRadius: 4, display: 'block' }}
                    />
                  ) : (
                    <div style={{ width: 56, height: 40, borderRadius: 4, background: '#f3f4f6' }} />
                  )}
                </td>
                <td style={tdStyle}>{post.title}</td>
                <td style={{ ...tdStyle, color: '#6b7280', fontSize: 12 }}>{post.tags.join(', ') || '—'}</td>
                <td style={tdStyle}>
                  <StatusPill status={post.status} />
                </td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>
                  {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : '—'}
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button variant="secondary" onClick={() => navigate(`/blog/${post.id}/edit`)}>
                      Edit
                    </Button>
                    <Button variant="danger" onClick={() => setPendingDelete(post)}>
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
          title="Delete blog post"
          message={`Delete "${pendingDelete.title}"? This cannot be undone.`}
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
