import { ChangeEvent, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { TextField, CheckboxField } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { HomepageSlide } from '../../types/catalog';

const BASE_PATH = '/admin/homepage-slides';
const QUERY_KEY = ['homepage-slides'];
const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp';

function EditSlideModal({ slide, onClose }: { slide: HomepageSlide; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(slide.title ?? '');
  const [subtitle, setSubtitle] = useState(slide.subtitle ?? '');
  const [linkUrl, setLinkUrl] = useState(slide.linkUrl ?? '');
  const [isActive, setIsActive] = useState(slide.isActive);

  const mutation = useMutation({
    mutationFn: () => apiClient.patch(`${BASE_PATH}/${slide.id}`, { title, subtitle, linkUrl, isActive }),
    onSuccess: () => {
      toast.show('success', 'Slide updated');
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      onClose();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to update slide'),
  });

  return (
    <Modal title="Edit slide" onClose={onClose} width={440}>
      <img src={slide.imageUrl} alt="" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', marginBottom: 14, borderRadius: 6 }} />
      <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <TextField label="Subtitle" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
      <TextField
        label="Link URL"
        placeholder="/products or https://..."
        value={linkUrl}
        onChange={(e) => setLinkUrl(e.target.value)}
      />
      <CheckboxField label="Active (visible on the storefront)" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}

export function HomepageSlidesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingSlide, setEditingSlide] = useState<HomepageSlide | null>(null);
  const [pendingDelete, setPendingDelete] = useState<HomepageSlide | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const slidesQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiClient.get<HomepageSlide[]>(BASE_PATH),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiClient.postForm<HomepageSlide>(BASE_PATH, formData);
    },
    onSuccess: () => {
      toast.show('success', 'Slide uploaded - click it to add a title, link, etc.');
      invalidate();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Upload failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (slideId: string) => apiClient.delete(`${BASE_PATH}/${slideId}`),
    onSuccess: () => {
      toast.show('success', 'Slide deleted');
      setPendingDelete(null);
      invalidate();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to delete slide');
      setPendingDelete(null);
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (items: { id: string; sortOrder: number }[]) => apiClient.patch(`${BASE_PATH}/reorder`, { items }),
    onSuccess: invalidate,
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to reorder slides'),
  });

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    event.target.value = '';
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) uploadMutation.mutate(file);
  }

  function handleDropOnSlide(targetId: string) {
    if (!draggedId || draggedId === targetId || !slides) return;
    const ids = slides.map((s) => s.id);
    const fromIndex = ids.indexOf(draggedId);
    const toIndex = ids.indexOf(targetId);
    const reordered = [...ids];
    reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, draggedId);
    reorderMutation.mutate(reordered.map((id, index) => ({ id, sortOrder: index })));
    setDraggedId(null);
  }

  const slides = slidesQuery.data;

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Homepage Slider</h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>
        Manage the banner slider shown at the top of the customer storefront homepage. Drag slides to reorder; only
        active slides are shown to customers.
      </p>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        style={{
          border: '2px dashed #d1d5db',
          borderRadius: 8,
          padding: 20,
          textAlign: 'center',
          marginBottom: 20,
          color: '#6b7280',
          fontSize: 13,
        }}
      >
        <p style={{ margin: '0 0 8px' }}>Drag and drop a banner image here, or</p>
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
          {uploadMutation.isPending ? 'Uploading…' : 'Choose file'}
        </Button>
        <input ref={fileInputRef} type="file" accept={ACCEPTED_TYPES} style={{ display: 'none' }} onChange={handleFileChange} />
        <p style={{ margin: '8px 0 0', fontSize: 11, color: '#9ca3af' }}>
          JPEG, PNG or WebP, up to 10MB - a wide banner (e.g. 1600x500) works best
        </p>
      </div>

      {slidesQuery.isLoading && <p style={{ color: '#9ca3af', fontSize: 13 }}>Loading slides…</p>}
      {slides && slides.length === 0 && <p style={{ color: '#9ca3af', fontSize: 13 }}>No slides yet - upload one above.</p>}

      {slides && slides.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {slides.map((slide) => (
            <div
              key={slide.id}
              draggable
              onDragStart={() => setDraggedId(slide.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDropOnSlide(slide.id)}
              onClick={() => setEditingSlide(slide)}
              style={{
                width: 220,
                border: slide.isActive ? '2px solid #4f46e5' : '1px solid #e5e7eb',
                borderRadius: 8,
                overflow: 'hidden',
                cursor: 'grab',
                background: '#fff',
                opacity: slide.isActive ? 1 : 0.55,
              }}
            >
              <img src={slide.imageUrl} alt="" style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }} />
              <div style={{ padding: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {slide.title || <span style={{ color: '#9ca3af', fontWeight: 400 }}>Untitled slide</span>}
                </div>
                <div style={{ fontSize: 11, color: slide.isActive ? '#4f46e5' : '#9ca3af', marginBottom: 6 }}>
                  {slide.isActive ? 'Active' : 'Hidden'}
                </div>
                <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <Button variant="secondary" onClick={() => setEditingSlide(slide)} style={{ fontSize: 11, padding: '4px 8px' }}>
                    Edit
                  </Button>
                  <Button variant="danger" onClick={() => setPendingDelete(slide)} style={{ fontSize: 11, padding: '4px 8px' }}>
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingSlide && <EditSlideModal slide={editingSlide} onClose={() => setEditingSlide(null)} />}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete slide"
          message="Delete this slide? This cannot be undone."
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
