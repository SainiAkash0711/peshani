import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../../components/Toast';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { TextField, SelectField } from '../../components/FormField';
import { InventoryItem, PaginatedResult, Warehouse } from '../../types/catalog';

export function TransferStockModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'for-transfer'],
    queryFn: () => apiClient.get<PaginatedResult<Warehouse>>('/warehouses?pageSize=100&status=active'),
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post('/inventory/transfer', {
        sourceWarehouseId: item.warehouseId,
        destinationWarehouseId,
        productId: item.productId,
        variantId: item.variantId ?? undefined,
        quantity,
        reason: reason || undefined,
      }),
    onSuccess: () => {
      toast.show('success', 'Stock transferred');
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to transfer stock'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!destinationWarehouseId) {
      setError('Choose a destination warehouse');
      return;
    }
    if (destinationWarehouseId === item.warehouseId) {
      setError('Destination must differ from the source warehouse');
      return;
    }
    mutation.mutate();
  }

  return (
    <Modal title={`Transfer stock: ${item.product.name}`} onClose={onClose} width={420}>
      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
        From <strong>{item.warehouse.name}</strong> · Available: {item.availableQuantity}
      </p>
      <form onSubmit={handleSubmit}>
        <SelectField
          label="Destination warehouse"
          value={destinationWarehouseId}
          onChange={(e) => setDestinationWarehouseId(e.target.value)}
          required
        >
          <option value="">— Select —</option>
          {warehousesQuery.data?.items
            .filter((w) => w.id !== item.warehouseId)
            .map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
        </SelectField>
        <TextField label="Quantity" type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} required />
        <TextField label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Transferring…' : 'Transfer'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
