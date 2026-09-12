import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { TextField, TextAreaField, SelectField, CheckboxField } from '../../components/FormField';
import { EntityPicker } from '../../components/EntityPicker';
import { DiscountType } from '../../types/promotions';
import { EntityOption, HydratedPromotion } from '../../lib/promotion-targeting';

export interface PromotionFormValues {
  name: string;
  description?: string;
  discountType: DiscountType;
  value: string;
  maximumDiscountAmount?: string;
  minimumOrderAmount?: string;
  isActive?: boolean;
  sortOrder?: number;
  productIds: string[];
  excludedProductIds: string[];
  categoryIds: string[];
  excludedCategoryIds: string[];
  brandIds: string[];
  excludedBrandIds: string[];
}

interface PromotionFormModalProps {
  title: string;
  initial?: HydratedPromotion;
  onSubmit: (values: PromotionFormValues) => Promise<void>;
  onClose: () => void;
}

function findDuplicateName(included: EntityOption[], excluded: EntityOption[]): string | null {
  const excludedIds = new Set(excluded.map((e) => e.id));
  const dupe = included.find((i) => excludedIds.has(i.id));
  return dupe ? dupe.name : null;
}

export function PromotionFormModal({ title, initial, onSubmit, onClose }: PromotionFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [discountType, setDiscountType] = useState<DiscountType>(initial?.discountType ?? 'PERCENTAGE');
  const [value, setValue] = useState(initial?.value ?? '');
  const [maximumDiscountAmount, setMaximumDiscountAmount] = useState(initial?.maximumDiscountAmount ?? '');
  const [minimumOrderAmount, setMinimumOrderAmount] = useState(initial?.minimumOrderAmount ?? '');
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder != null ? String(initial.sortOrder) : '0');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);

  const [productIds, setProductIds] = useState<EntityOption[]>(initial?.productIds ?? []);
  const [excludedProductIds, setExcludedProductIds] = useState<EntityOption[]>(initial?.excludedProductIds ?? []);
  const [categoryIds, setCategoryIds] = useState<EntityOption[]>(initial?.categoryIds ?? []);
  const [excludedCategoryIds, setExcludedCategoryIds] = useState<EntityOption[]>(initial?.excludedCategoryIds ?? []);
  const [brandIds, setBrandIds] = useState<EntityOption[]>(initial?.brandIds ?? []);
  const [excludedBrandIds, setExcludedBrandIds] = useState<EntityOption[]>(initial?.excludedBrandIds ?? []);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (name.trim().length < 2) {
      setError('Name must be at least 2 characters');
      return;
    }
    if (value.trim().length < 1 || Number.isNaN(Number(value))) {
      setError('A valid discount value is required');
      return;
    }
    if (discountType === 'PERCENTAGE' && (Number(value) <= 0 || Number(value) > 100)) {
      setError('Percentage discounts must be between 0 and 100');
      return;
    }
    if (minimumOrderAmount.trim() && Number.isNaN(Number(minimumOrderAmount))) {
      setError('Minimum order amount must be a number');
      return;
    }
    if (discountType === 'PERCENTAGE' && maximumDiscountAmount.trim() && Number.isNaN(Number(maximumDiscountAmount))) {
      setError('Maximum discount amount must be a number');
      return;
    }

    const dupeProduct = findDuplicateName(productIds, excludedProductIds);
    if (dupeProduct) {
      setError(`"${dupeProduct}" cannot be both included and excluded`);
      return;
    }
    const dupeCategory = findDuplicateName(categoryIds, excludedCategoryIds);
    if (dupeCategory) {
      setError(`"${dupeCategory}" cannot be both included and excluded`);
      return;
    }
    const dupeBrand = findDuplicateName(brandIds, excludedBrandIds);
    if (dupeBrand) {
      setError(`"${dupeBrand}" cannot be both included and excluded`);
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        discountType,
        value: value.trim(),
        maximumDiscountAmount: discountType === 'PERCENTAGE' ? maximumDiscountAmount.trim() || undefined : undefined,
        minimumOrderAmount: minimumOrderAmount.trim() || undefined,
        isActive,
        sortOrder: sortOrder.trim() ? Number(sortOrder) : undefined,
        productIds: productIds.map((o) => o.id),
        excludedProductIds: excludedProductIds.map((o) => o.id),
        categoryIds: categoryIds.map((o) => o.id),
        excludedCategoryIds: excludedCategoryIds.map((o) => o.id),
        brandIds: brandIds.map((o) => o.id),
        excludedBrandIds: excludedBrandIds.map((o) => o.id),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} width={680}>
      <form onSubmit={handleSubmit}>
        <h3 style={{ fontSize: 13, textTransform: 'uppercase', color: '#9ca3af', marginBottom: 8 }}>Basic</h3>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        <TextAreaField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />

        <h3 style={{ fontSize: 13, textTransform: 'uppercase', color: '#9ca3af', margin: '16px 0 8px' }}>Discount</h3>
        <SelectField
          label="Discount type"
          value={discountType}
          onChange={(e) => setDiscountType(e.target.value as DiscountType)}
        >
          <option value="PERCENTAGE">Percentage</option>
          <option value="FIXED_AMOUNT">Fixed amount</option>
        </SelectField>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <TextField
              label={discountType === 'PERCENTAGE' ? 'Value (%)' : 'Value (₹)'}
              placeholder={discountType === 'PERCENTAGE' ? 'e.g. 10' : 'e.g. 300.00'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          </div>
          {discountType === 'PERCENTAGE' && (
            <div style={{ flex: 1 }}>
              <TextField
                label="Maximum discount amount (₹)"
                placeholder="No cap"
                value={maximumDiscountAmount}
                onChange={(e) => setMaximumDiscountAmount(e.target.value)}
              />
            </div>
          )}
        </div>

        <h3 style={{ fontSize: 13, textTransform: 'uppercase', color: '#9ca3af', margin: '16px 0 8px' }}>
          Eligibility
        </h3>
        <TextField
          label="Minimum order amount (₹)"
          placeholder="No minimum"
          value={minimumOrderAmount}
          onChange={(e) => setMinimumOrderAmount(e.target.value)}
        />
        <p style={{ fontSize: 12, color: '#9ca3af', margin: '0 0 10px' }}>
          Leave every picker below empty to make this promotion store-wide. Adding items to "included" restricts the
          promotion to only those; "excluded" items never get the discount even if otherwise eligible.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <EntityPicker label="Included products" resourceUrl="/products" selected={productIds} onChange={setProductIds} />
          <EntityPicker
            label="Excluded products"
            resourceUrl="/products"
            selected={excludedProductIds}
            onChange={setExcludedProductIds}
          />
          <EntityPicker
            label="Included categories"
            resourceUrl="/categories"
            selected={categoryIds}
            onChange={setCategoryIds}
          />
          <EntityPicker
            label="Excluded categories"
            resourceUrl="/categories"
            selected={excludedCategoryIds}
            onChange={setExcludedCategoryIds}
          />
          <EntityPicker label="Included brands" resourceUrl="/brands" selected={brandIds} onChange={setBrandIds} />
          <EntityPicker
            label="Excluded brands"
            resourceUrl="/brands"
            selected={excludedBrandIds}
            onChange={setExcludedBrandIds}
          />
        </div>

        <h3 style={{ fontSize: 13, textTransform: 'uppercase', color: '#9ca3af', margin: '16px 0 8px' }}>Status</h3>
        <TextField label="Sort order" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        <CheckboxField label="Active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />

        {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save promotion'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
