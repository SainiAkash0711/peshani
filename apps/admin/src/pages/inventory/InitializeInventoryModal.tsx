import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../../components/Toast';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { TextField, SelectField } from '../../components/FormField';
import { PaginatedResult, ProductSummary, ProductVariant, Warehouse } from '../../types/catalog';

export function InitializeInventoryModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [warehouseId, setWarehouseId] = useState('');
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState(0);
  const [lowStockThreshold, setLowStockThreshold] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'for-init'],
    queryFn: () => apiClient.get<PaginatedResult<Warehouse>>('/warehouses?pageSize=100&status=active'),
  });
  const productsQuery = useQuery({
    queryKey: ['products', 'for-init'],
    queryFn: () => apiClient.get<PaginatedResult<ProductSummary>>('/products?pageSize=100'),
  });

  const selectedProduct = productsQuery.data?.items.find((p) => p.id === productId);
  const isVariable = selectedProduct?.productType === 'VARIABLE';

  const variantsQuery = useQuery({
    queryKey: ['product-variants', productId, 'for-init'],
    queryFn: () => apiClient.get<PaginatedResult<ProductVariant>>(`/products/${productId}/variants?pageSize=100`),
    enabled: isVariable,
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post('/inventory', {
        warehouseId,
        productId,
        variantId: isVariable ? variantId || undefined : undefined,
        quantity,
        lowStockThreshold,
      }),
    onSuccess: () => {
      toast.show('success', 'Inventory initialized');
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to initialize inventory'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!warehouseId || !productId) {
      setError('Choose a warehouse and a product');
      return;
    }
    if (isVariable && !variantId) {
      setError('Choose a variant');
      return;
    }
    mutation.mutate();
  }

  return (
    <Modal title="Initialize inventory" onClose={onClose} width={420}>
      <form onSubmit={handleSubmit}>
        <SelectField label="Warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
          <option value="">— Select —</option>
          {warehousesQuery.data?.items.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Product"
          value={productId}
          onChange={(e) => { setProductId(e.target.value); setVariantId(''); }}
          required
        >
          <option value="">— Select —</option>
          {productsQuery.data?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.productType})
            </option>
          ))}
        </SelectField>
        {isVariable && (
          <SelectField label="Variant" value={variantId} onChange={(e) => setVariantId(e.target.value)} required>
            <option value="">— Select —</option>
            {variantsQuery.data?.items.map((v) => (
              <option key={v.id} value={v.id}>
                {v.attributeValues.map((av) => av.valueLabel).join(' / ')} ({v.sku})
              </option>
            ))}
          </SelectField>
        )}
        <TextField label="Initial quantity" type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} required />
        <TextField
          label="Low stock threshold"
          type="number"
          value={lowStockThreshold}
          onChange={(e) => setLowStockThreshold(Number(e.target.value))}
        />
        {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Initialize'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
