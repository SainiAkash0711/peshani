import { ChangeEvent, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../Toast';
import { Button } from '../Button';
import { TextField } from '../FormField';
import { Modal } from '../Modal';
import { ConfirmDialog } from '../ConfirmDialog';
import { MediaImage } from '../../types/catalog';

const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp';

function EditImageModal({ image, basePath, queryKey, onClose }: { image: MediaImage; basePath: string; queryKey: string[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [altText, setAltText] = useState(image.altText ?? '');
  const [caption, setCaption] = useState(image.caption ?? '');

  const mutation = useMutation({
    mutationFn: () => apiClient.patch(`${basePath}/${image.id}`, { altText, caption }),
    onSuccess: () => {
      toast.show('success', 'Image updated');
      void queryClient.invalidateQueries({ queryKey });
      onClose();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to update image'),
  });

  return (
    <Modal title="Edit image" onClose={onClose} width={400}>
      <img src={image.url} alt={image.altText ?? ''} style={{ width: '100%', maxHeight: 200, objectFit: 'contain', marginBottom: 14, borderRadius: 6 }} />
      <TextField label="Alt text" value={altText} onChange={(e) => setAltText(e.target.value)} />
      <TextField label="Caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
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

const MAX_IMAGES = 5;

export function MediaGallery({
  basePath,
  queryKey,
  minImages = 1,
  label = 'Product Images',
}: {
  basePath: string;
  queryKey: string[];
  /** Products always need at least one photo; variants may legitimately have none (they fall back to the product's own images), so callers pass 0 there. */
  minImages?: number;
  label?: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingImage, setEditingImage] = useState<MediaImage | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MediaImage | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const imagesQuery = useQuery({
    queryKey,
    queryFn: () => apiClient.get<MediaImage[]>(basePath),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey });
  }

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiClient.postForm<MediaImage>(basePath, formData);
    },
    onSuccess: () => {
      toast.show('success', 'Image uploaded');
      invalidate();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Upload failed'),
  });

  const primaryMutation = useMutation({
    mutationFn: (imageId: string) => apiClient.patch(`${basePath}/${imageId}/primary`),
    onSuccess: () => {
      toast.show('success', 'Primary image updated');
      invalidate();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to set primary image'),
  });

  const deleteMutation = useMutation({
    mutationFn: (imageId: string) => apiClient.delete(`${basePath}/${imageId}`),
    onSuccess: () => {
      toast.show('success', 'Image deleted');
      setPendingDelete(null);
      invalidate();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to delete image');
      setPendingDelete(null);
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (items: { id: string; sortOrder: number }[]) => apiClient.patch(`${basePath}/reorder`, { items }),
    onSuccess: invalidate,
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to reorder images'),
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

  function handleDragStart(id: string) {
    setDraggedId(id);
  }

  function handleDropOnImage(targetId: string) {
    if (!draggedId || draggedId === targetId || !images) return;
    const ids = images.map((i) => i.id);
    const fromIndex = ids.indexOf(draggedId);
    const toIndex = ids.indexOf(targetId);
    const reordered = [...ids];
    reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, draggedId);
    reorderMutation.mutate(reordered.map((id, index) => ({ id, sortOrder: index })));
    setDraggedId(null);
  }

  const images = imagesQuery.data;
  const imageCount = images?.length ?? 0;
  const atMax = imageCount >= MAX_IMAGES;
  const atMin = imageCount <= minImages;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
          {label}: {imageCount} / {MAX_IMAGES}
        </span>
        {atMax && <span style={{ fontSize: 12, color: '#b45309' }}>Maximum image limit reached.</span>}
        {!atMax && minImages > 0 && atMin && <span style={{ fontSize: 12, color: '#6b7280' }}>At least {minImages} image is required.</span>}
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={atMax ? undefined : handleDrop}
        style={{
          border: '2px dashed #d1d5db',
          borderRadius: 8,
          padding: 20,
          textAlign: 'center',
          marginBottom: 16,
          color: '#6b7280',
          fontSize: 13,
          opacity: atMax ? 0.6 : 1,
        }}
      >
        <p style={{ margin: '0 0 8px' }}>{atMax ? 'Maximum of 5 images reached' : 'Drag and drop an image here, or'}</p>
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending || atMax}>
          {uploadMutation.isPending ? 'Uploading…' : 'Choose file'}
        </Button>
        <input ref={fileInputRef} type="file" accept={ACCEPTED_TYPES} style={{ display: 'none' }} onChange={handleFileChange} disabled={atMax} />
        <p style={{ margin: '8px 0 0', fontSize: 11, color: '#9ca3af' }}>JPEG, PNG or WebP, up to 10MB</p>
      </div>

      {imagesQuery.isLoading && <p style={{ color: '#9ca3af', fontSize: 13 }}>Loading images…</p>}
      {images && images.length === 0 && <p style={{ color: '#9ca3af', fontSize: 13 }}>No images yet.</p>}

      {images && images.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {images.map((image) => (
            <div
              key={image.id}
              draggable
              onDragStart={() => handleDragStart(image.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDropOnImage(image.id)}
              style={{
                width: 140,
                border: image.isPrimary ? '2px solid #4f46e5' : '1px solid #e5e7eb',
                borderRadius: 8,
                overflow: 'hidden',
                cursor: 'grab',
                background: '#fff',
              }}
            >
              <img src={image.url} alt={image.altText ?? ''} style={{ width: '100%', height: 100, objectFit: 'cover', display: 'block' }} />
              <div style={{ padding: 8 }}>
                {image.isPrimary ? (
                  <div style={{ fontSize: 11, color: '#4f46e5', fontWeight: 600, marginBottom: 6 }}>★ Primary</div>
                ) : (
                  <button
                    onClick={() => primaryMutation.mutate(image.id)}
                    style={{ fontSize: 11, background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 0, marginBottom: 6 }}
                  >
                    Set as primary
                  </button>
                )}
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button variant="secondary" onClick={() => setEditingImage(image)} style={{ fontSize: 11, padding: '4px 8px' }}>
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => setPendingDelete(image)}
                    disabled={atMin}
                    title={atMin ? `At least ${minImages} image is required` : undefined}
                    style={{ fontSize: 11, padding: '4px 8px' }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingImage && (
        <EditImageModal image={editingImage} basePath={basePath} queryKey={queryKey} onClose={() => setEditingImage(null)} />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete image"
          message="Delete this image? This cannot be undone."
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
