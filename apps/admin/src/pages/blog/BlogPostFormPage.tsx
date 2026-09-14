import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { TextField, TextAreaField, SelectField } from '../../components/FormField';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { cardStyle, pageHeaderStyle } from '../../styles';
import { BlogPost, BlogPostStatus } from '../../types/catalog';

interface FormState {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  authorName: string;
  tagNames: string;
  status: BlogPostStatus;
}

const EMPTY_FORM: FormState = {
  title: '',
  slug: '',
  excerpt: '',
  content: '',
  authorName: '',
  tagNames: '',
  status: 'DRAFT',
};

function postToForm(post: BlogPost): FormState {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt ?? '',
    content: post.content,
    authorName: post.authorName ?? '',
    tagNames: post.tags.join(', '),
    status: post.status,
  };
}

export function BlogPostFormPage() {
  const { id } = useParams();
  const isEditing = !!id;
  const navigate = useNavigate();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [initialForm, setInitialForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);

  const postQuery = useQuery({
    queryKey: ['blog-post', id],
    queryFn: () => apiClient.get<BlogPost>(`/admin/blog-posts/${id}`),
    enabled: isEditing,
  });

  useEffect(() => {
    if (postQuery.data) {
      setForm(postToForm(postQuery.data));
      setInitialForm(postToForm(postQuery.data));
      setCoverImageUrl(postQuery.data.coverImageUrl ?? null);
    }
  }, [postQuery.data]);

  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialForm), [form, initialForm]);

  useEffect(() => {
    function handler(event: BeforeUnloadEvent) {
      if (isDirty) event.preventDefault();
    }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  function buildDto() {
    return {
      title: form.title,
      slug: form.slug || undefined,
      excerpt: form.excerpt || undefined,
      content: form.content,
      authorName: form.authorName || undefined,
      tags: form.tagNames
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      status: form.status,
    };
  }

  const createMutation = useMutation({
    mutationFn: () => apiClient.post<BlogPost>('/admin/blog-posts', buildDto()),
    onSuccess: (post) => {
      toast.show('success', 'Blog post created');
      setInitialForm(form);
      navigate(`/blog/${post.id}/edit`, { replace: true });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create blog post'),
  });

  const updateMutation = useMutation({
    mutationFn: () => apiClient.patch<BlogPost>(`/admin/blog-posts/${id}`, buildDto()),
    onSuccess: (post) => {
      toast.show('success', 'Blog post saved');
      setForm(postToForm(post));
      setInitialForm(postToForm(post));
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to save blog post'),
  });

  const uploadCoverMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiClient.postForm<BlogPost>(`/admin/blog-posts/${id}/cover-image`, formData);
    },
    onSuccess: (post) => {
      toast.show('success', 'Cover image uploaded');
      setCoverImageUrl(post.coverImageUrl ?? null);
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Cover image upload failed'),
  });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (isEditing) {
      await updateMutation.mutateAsync();
    } else {
      await createMutation.mutateAsync();
    }
  }

  function handleCoverFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) uploadCoverMutation.mutate(file);
    event.target.value = '';
  }

  function handleBack() {
    if (isDirty) {
      setConfirmingLeave(true);
    } else {
      navigate('/blog');
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isEditing && postQuery.isLoading) {
    return <p style={{ color: '#9ca3af' }}>Loading…</p>;
  }

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{isEditing ? `Edit ${initialForm.title || 'Post'}` : 'New Blog Post'}</h1>
        <Button variant="secondary" onClick={handleBack}>
          {isDirty ? 'Back (unsaved changes)' : 'Back to Blog'}
        </Button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Basic information</h3>
          <TextField label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required autoFocus />
          <TextField label="Slug" placeholder="auto-generated if left blank" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          <TextField label="Author" value={form.authorName} onChange={(e) => setForm({ ...form, authorName: e.target.value })} />
          <TextField
            label="Tags"
            placeholder="e.g. Gifting, Home Decor, Diwali"
            value={form.tagNames}
            onChange={(e) => setForm({ ...form, tagNames: e.target.value })}
          />
          <SelectField label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as BlogPostStatus })}>
            <option value="DRAFT">Draft (hidden from the storefront)</option>
            <option value="PUBLISHED">Published (visible on the storefront)</option>
          </SelectField>
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Cover image</h3>
          {coverImageUrl && (
            <img src={coverImageUrl} alt="" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 6, marginBottom: 12 }} />
          )}
          {isEditing ? (
            <>
              <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploadCoverMutation.isPending}>
                {uploadCoverMutation.isPending ? 'Uploading…' : coverImageUrl ? 'Replace cover image' : 'Upload cover image'}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={handleCoverFileChange}
              />
              <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>JPEG, PNG or WebP - a wide image (e.g. 1200x675) works best.</p>
            </>
          ) : (
            <p style={{ fontSize: 12, color: '#9ca3af' }}>Save this post first to unlock the cover image upload.</p>
          )}
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Content</h3>
          <TextAreaField
            label="Excerpt"
            rows={2}
            placeholder="A one or two sentence teaser shown on the blog listing page"
            value={form.excerpt}
            onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
          />
          <TextAreaField
            label="Content"
            rows={16}
            required
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
        </div>

        {error && <p style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}

        <div>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? 'Saving…' : isEditing ? 'Save changes' : 'Create post'}
          </Button>
        </div>
      </form>

      {confirmingLeave && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          message="You have unsaved changes. Leave this page without saving?"
          danger
          confirmLabel="Discard"
          onConfirm={() => navigate('/blog')}
          onCancel={() => setConfirmingLeave(false)}
        />
      )}
    </div>
  );
}
