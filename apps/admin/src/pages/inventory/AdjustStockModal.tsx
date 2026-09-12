import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../../components/Toast';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { TextField } from '../../components/FormField';
import { InventoryItem } from '../../types/catalog';

export function AdjustStockModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => apiClient.post('/inventory/adjust', { inventoryItemId: item.id, quantity, reason }),
    onSuccess: () => {
      toast.show('success', 'Stock adjusted');
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to adjust stock'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (quantity === 0) {
      setError('Enter a non-zero quantity (positive to add, negative to remove)');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required');
      return;
    }
    mutation.mutate();
  }

  return (
    <Modal title={`Adjust stock: ${item.product.name}`} onClose={onClose} width={400}>
      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
        Current on-hand: {item.onHandQuantity} · Available: {item.availableQuantity}
      </p>
      <form onSubmit={handleSubmit}>
        <TextField
          label="Adjustment (positive to add, negative to remove)"
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
          required
          autoFocus
        />
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
        {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Apply adjustment'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
