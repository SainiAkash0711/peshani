import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../Toast';
import { Button } from '../Button';
import { CheckboxField } from '../FormField';
import { cardStyle } from '../../styles';
import { Attribute, AttributeValue, CombinationPreview, GenerateVariantsResult, PaginatedResult, VariantAxis } from '../../types/catalog';

/**
 * Reusable "select attributes -> select values -> preview -> generate"
 * foundation for the variant builder. Not yet reachable from the admin nav -
 * there's no Product page to embed it in until Phase 2D creates one. Product
 * pages should render <VariantBuilder productId={product.id} /> once that
 * page exists.
 */
export function VariantBuilder({ productId }: { productId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selectedAttributeIds, setSelectedAttributeIds] = useState<Set<string>>(new Set());
  const [selectedValueIds, setSelectedValueIds] = useState<Record<string, Set<string>>>({});
  const [preview, setPreview] = useState<CombinationPreview | null>(null);

  const attributesQuery = useQuery({
    queryKey: ['attributes', 'for-variant-builder'],
    queryFn: () => apiClient.get<PaginatedResult<Attribute>>('/attributes?pageSize=100&status=active'),
  });

  const attributes = attributesQuery.data?.items ?? [];

  // useQueries (not useQuery-in-a-.map) because `attributes` grows from 0 to N
  // items once it loads - calling useQuery a variable number of times across
  // renders would violate the Rules of Hooks.
  const valueQueries = useQueries({
    queries: attributes.map((attribute) => ({
      queryKey: ['attribute-values', attribute.id, 'for-variant-builder'],
      queryFn: () => apiClient.get<PaginatedResult<AttributeValue>>(`/attributes/${attribute.id}/values?pageSize=200`),
      enabled: selectedAttributeIds.has(attribute.id),
    })),
  });

  const axes: VariantAxis[] = useMemo(
    () =>
      attributes
        .filter((a) => selectedAttributeIds.has(a.id) && (selectedValueIds[a.id]?.size ?? 0) > 0)
        .map((a) => ({ attributeId: a.id, valueIds: Array.from(selectedValueIds[a.id]) })),
    [attributes, selectedAttributeIds, selectedValueIds],
  );

  const previewMutation = useMutation({
    mutationFn: (requestAxes: VariantAxis[]) =>
      apiClient.post<CombinationPreview>(`/products/${productId}/variants/preview-combinations`, { axes: requestAxes }),
    onSuccess: setPreview,
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to preview combinations'),
  });

  useEffect(() => {
    if (axes.length === 0) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(() => previewMutation.mutate(axes), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(axes)]);

  const generateMutation = useMutation({
    mutationFn: (requestAxes: VariantAxis[]) =>
      apiClient.post<GenerateVariantsResult>(`/products/${productId}/variants/generate`, { axes: requestAxes }),
    onSuccess: (result) => {
      toast.show(
        'success',
        `Generated ${result.created.length} new variant(s), preserved ${result.preserved.length} existing one(s).`,
      );
      void queryClient.invalidateQueries({ queryKey: ['product-variants', productId] });
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to generate variants'),
  });

  function toggleAttribute(attributeId: string) {
    setSelectedAttributeIds((prev) => {
      const next = new Set(prev);
      if (next.has(attributeId)) {
        next.delete(attributeId);
        setSelectedValueIds((values) => {
          const { [attributeId]: _removed, ...rest } = values;
          return rest;
        });
      } else {
        next.add(attributeId);
      }
      return next;
    });
  }

  function toggleValue(attributeId: string, valueId: string) {
    setSelectedValueIds((prev) => {
      const current = new Set(prev[attributeId] ?? []);
      if (current.has(valueId)) {
        current.delete(valueId);
      } else {
        current.add(valueId);
      }
      return { ...prev, [attributeId]: current };
    });
  }

  return (
    <div style={cardStyle}>
      <h3 style={{ marginTop: 0 }}>Variant builder</h3>

      {attributesQuery.isLoading && <p style={{ color: '#9ca3af' }}>Loading attributes…</p>}
      {attributes.length === 0 && !attributesQuery.isLoading && (
        <p style={{ color: '#9ca3af' }}>No active attributes yet — create one under Attributes first.</p>
      )}

      {attributes.map((attribute, index) => (
        <div key={attribute.id} style={{ marginBottom: 12, borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>
          <CheckboxField
            label={attribute.name}
            checked={selectedAttributeIds.has(attribute.id)}
            onChange={() => toggleAttribute(attribute.id)}
          />
          {selectedAttributeIds.has(attribute.id) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, paddingLeft: 24 }}>
              {valueQueries[index]?.data?.items.map((value) => (
                <label key={value.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={selectedValueIds[attribute.id]?.has(value.id) ?? false}
                    onChange={() => toggleValue(attribute.id, value.id)}
                  />
                  {value.value}
                </label>
              ))}
            </div>
          )}
        </div>
      ))}

      {preview && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 8,
            background: preview.exceedsLimit ? '#fef2f2' : '#f0fdf4',
            color: preview.exceedsLimit ? '#991b1b' : '#166534',
            fontSize: 13,
          }}
        >
          {preview.exceedsLimit
            ? `${preview.total} combinations requested, which exceeds the limit of ${preview.maxAllowed}. Narrow your selection.`
            : `${preview.total} combination(s) will be generated (existing matching variants are preserved, not recreated).`}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <Button
          disabled={axes.length === 0 || !preview || preview.exceedsLimit || generateMutation.isPending}
          onClick={() => generateMutation.mutate(axes)}
        >
          {generateMutation.isPending ? 'Generating…' : 'Generate variants'}
        </Button>
      </div>
    </div>
  );
}
