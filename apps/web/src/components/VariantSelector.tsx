'use client';

import { useMemo, useState } from 'react';
import type { ProductDetail } from '../types/catalog';
import { formatPrice } from '../lib/format';
import { AvailabilityBadge } from './AvailabilityBadge';

/**
 * Pure presentation + selection logic - no Cart/Add-to-Cart affordance of
 * any kind lives here (Phase 3 is catalog-only, see the scope boundary in
 * the final report). Valid-combination checking reuses each ACTIVE variant's
 * own attributeValueIds, exactly like the admin VariantBuilder does with
 * ProductVariantAttributeValue relations - just read-only here.
 */
export function VariantSelector({
  product,
  currencySymbol,
  onVariantChange,
}: {
  product: ProductDetail;
  currencySymbol?: string;
  onVariantChange?: (variant: ProductDetail['variants'][number] | null) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});

  const matchedVariant = useMemo(() => {
    const selectedAttributeIds = Object.keys(selected);
    if (selectedAttributeIds.length !== product.options.length) return null;
    return (
      product.variants.find((variant) => {
        const variantValueIds = new Set(variant.attributeValueIds);
        return Object.values(selected).every((valueId) => variantValueIds.has(valueId));
      }) ?? null
    );
  }, [selected, product.options.length, product.variants]);

  function selectValue(attributeId: string, valueId: string) {
    const next = { ...selected, [attributeId]: valueId };
    setSelected(next);
    if (onVariantChange) {
      const selectedAttributeIds = Object.keys(next);
      const variant =
        selectedAttributeIds.length === product.options.length
          ? product.variants.find((v) => {
              const set = new Set(v.attributeValueIds);
              return Object.values(next).every((id) => set.has(id));
            }) ?? null
          : null;
      onVariantChange(variant);
    }
  }

  function isValueAvailable(attributeId: string, valueId: string): boolean {
    const candidate = { ...selected, [attributeId]: valueId };
    return product.variants.some((variant) => {
      const set = new Set(variant.attributeValueIds);
      return Object.values(candidate).every((id) => set.has(id));
    });
  }

  if (product.productType !== 'VARIABLE' || product.options.length === 0) {
    return null;
  }

  return (
    <div>
      {product.options.map((option) => (
        <div className="pdp__option" key={option.attributeId}>
          <div className="pdp__option-label">{option.attributeName}</div>
          <div className="pdp__option-values">
            {option.values.map((value) => {
              const isSelected = selected[option.attributeId] === value.valueId;
              const isAvailable = isValueAvailable(option.attributeId, value.valueId);
              return (
                <button
                  key={value.valueId}
                  type="button"
                  className={`option-swatch${isSelected ? ' is-selected' : ''}${!isAvailable ? ' is-disabled' : ''}`}
                  disabled={!isAvailable}
                  onClick={() => selectValue(option.attributeId, value.valueId)}
                >
                  {value.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {matchedVariant ? (
        <div className="pdp__price" key={matchedVariant.id}>
          {formatPrice(matchedVariant.price, currencySymbol)}
          {matchedVariant.compareAtPrice && (
            <span className="card__price-compare">{formatPrice(matchedVariant.compareAtPrice, currencySymbol)}</span>
          )}
          <AvailabilityBadge availability={matchedVariant.availability} />
        </div>
      ) : (
        <p className="pdp__hint">Select an option to see price and availability.</p>
      )}
    </div>
  );
}
