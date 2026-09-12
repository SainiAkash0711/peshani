import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { TextField, SelectField } from '../../components/FormField';
import { VariantBuilder } from '../../components/variant-builder/VariantBuilder';
import { MediaGallery } from '../../components/media/MediaGallery';
import { cardStyle, tableStyle, tdStyle, thStyle } from '../../styles';
import { PaginatedResult, ProductVariant, ProductVariantStatus } from '../../types/catalog';

function VariantEditModal({ variant, productId, onClose }: { variant: ProductVariant; productId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [sku, setSku] = useState(variant.sku);
  const [barcode, setBarcode] = useState(variant.barcode ?? '');
  const [price, setPrice] = useState(variant.price);
  const [costPrice, setCostPrice] = useState(variant.costPrice ?? '');
  const [weight, setWeight] = useState(variant.weight ?? '');
  const [status, setStatus] = useState<ProductVariantStatus>(variant.status);
  const [error, setError] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: () =>
      apiClient.patch(`/products/${productId}/variants/${variant.id}`, {
        sku,
        barcode: barcode || undefined,
        price,
        costPrice: costPrice || undefined,
        weight: weight || undefined,
        status,
      }),
    onSuccess: () => {
      toast.show('success', 'Variant updated');
      void queryClient.invalidateQueries({ queryKey: ['product-variants', productId] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to update variant'),
  });

  const label = variant.attributeValues.map((v) => v.valueLabel).join(' / ');

  return (
    <Modal title={`Edit variant: ${label}`} onClose={onClose} width={560}>
      <TextField label="SKU" value={sku} onChange={(e) => setSku(e.target.value)} />
      <TextField label="Barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
      <TextField label="Price" value={price} onChange={(e) => setPrice(e.target.value)} />
      <TextField label="Cost price" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
      <TextField label="Weight (kg)" value={weight} onChange={(e) => setWeight(e.target.value)} />
      <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as ProductVariantStatus)}>
        <option value="ACTIVE">Active</option>
        <option value="INACTIVE">Inactive</option>
        <option value="ARCHIVED">Archived</option>
      </SelectField>

      <div style={{ marginTop: 8, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Variant images</div>
        <MediaGallery
          basePath={`/products/${productId}/variants/${variant.id}/images`}
          queryKey={['variant-images', variant.id]}
          minImages={0}
          label="Variant Images"
        />
      </div>

      {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button variant="secondary" onClick={onClose} disabled={updateMutation.isPending}>
          Cancel
        </Button>
        <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? 'Saving…' : 'Save variant'}
        </Button>
      </div>
    </Modal>
  );
}

export function ProductVariantsSection({ productId }: { productId: string }) {
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);

  const variantsQuery = useQuery({
    queryKey: ['product-variants', productId],
    queryFn: () => apiClient.get<PaginatedResult<ProductVariant>>(`/products/${productId}/variants?pageSize=100`),
  });

  const variants = variantsQuery.data?.items ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <VariantBuilder productId={productId} />

      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Variants ({variants.length})</h3>
        {variantsQuery.isLoading && <p style={{ color: '#9ca3af' }}>Loading…</p>}
        {!variantsQuery.isLoading && variants.length === 0 && (
          <p style={{ color: '#9ca3af' }}>No variants yet — use the builder above to generate some.</p>
        )}
        {variants.length > 0 && (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Combination</th>
                <th style={thStyle}>SKU</th>
                <th style={thStyle}>Price</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((variant) => (
                <tr key={variant.id}>
                  <td style={tdStyle}>{variant.attributeValues.map((v) => v.valueLabel).join(' / ')}</td>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>{variant.sku}</td>
                  <td style={tdStyle}>₹{variant.price}</td>
                  <td style={tdStyle}>
                    <StatusBadge isActive={variant.status === 'ACTIVE'} />
                  </td>
                  <td style={tdStyle}>
                    <Button variant="secondary" onClick={() => setEditingVariant(variant)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editingVariant && (
        <VariantEditModal variant={editingVariant} productId={productId} onClose={() => setEditingVariant(null)} />
      )}
    </div>
  );
}
