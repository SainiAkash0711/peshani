import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { TextField, CheckboxField } from '../../components/FormField';
import { PromotionOption, PromotionPicker } from '../../components/PromotionPicker';
import { CouponSummary } from '../../types/promotions';

export interface CouponEditTarget extends CouponSummary {
  promotionName: string;
}

export interface CouponFormValues {
  promotionId: string;
  code: string;
  isActive?: boolean;
  startsAt?: string;
  endsAt?: string;
  usageLimit?: number;
  perCustomerUsageLimit?: number;
}

interface CouponFormModalProps {
  title: string;
  initial?: CouponEditTarget;
  onSubmit: (values: CouponFormValues) => Promise<void>;
  onClose: () => void;
}

const CODE_PATTERN = /^[A-Za-z0-9_-]{3,40}$/;

function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

export function CouponFormModal({ title, initial, onSubmit, onClose }: CouponFormModalProps) {
  const [promotion, setPromotion] = useState<PromotionOption | null>(
    initial ? { id: initial.promotionId, name: initial.promotionName } : null,
  );
  const [code, setCode] = useState(initial?.code ?? '');
  const [startsAt, setStartsAt] = useState(toDateInputValue(initial?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toDateInputValue(initial?.endsAt ?? null));
  const [usageLimit, setUsageLimit] = useState(initial?.usageLimit != null ? String(initial.usageLimit) : '');
  const [perCustomerUsageLimit, setPerCustomerUsageLimit] = useState(
    initial?.perCustomerUsageLimit != null ? String(initial.perCustomerUsageLimit) : '',
  );
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const codeLocked = Boolean(initial && initial.usageCount > 0);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!promotion) {
      setError('Choose a promotion');
      return;
    }
    if (!CODE_PATTERN.test(code.trim())) {
      setError('Code must be 3-40 characters: letters, digits, hyphens, or underscores only');
      return;
    }
    if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) {
      setError('End date cannot be before start date');
      return;
    }
    if (usageLimit.trim() && (!Number.isInteger(Number(usageLimit)) || Number(usageLimit) < 1)) {
      setError('Usage limit must be a whole number of at least 1');
      return;
    }
    if (perCustomerUsageLimit.trim() && (!Number.isInteger(Number(perCustomerUsageLimit)) || Number(perCustomerUsageLimit) < 1)) {
      setError('Per-customer usage limit must be a whole number of at least 1');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        promotionId: promotion.id,
        code: code.trim(),
        isActive,
        startsAt: startsAt || undefined,
        endsAt: endsAt || undefined,
        usageLimit: usageLimit.trim() ? Number(usageLimit) : undefined,
        perCustomerUsageLimit: perCustomerUsageLimit.trim() ? Number(perCustomerUsageLimit) : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} width={480}>
      <form onSubmit={handleSubmit}>
        <PromotionPicker value={promotion} onChange={setPromotion} />
        <TextField
          label="Coupon code"
          placeholder="e.g. SUMMER10"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={codeLocked}
          required
          autoFocus={!initial}
        />
        {codeLocked && (
          <p style={{ fontSize: 12, color: '#9ca3af', marginTop: -10, marginBottom: 14 }}>
            This coupon has already been redeemed, so its code can no longer be changed.
          </p>
        )}
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <TextField label="Starts at (optional)" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <TextField label="Ends at (optional)" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <TextField
              label="Usage limit (optional)"
              type="number"
              min={1}
              placeholder="Unlimited"
              value={usageLimit}
              onChange={(e) => setUsageLimit(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <TextField
              label="Per-customer usage limit (optional)"
              type="number"
              min={1}
              placeholder="Unlimited"
              value={perCustomerUsageLimit}
              onChange={(e) => setPerCustomerUsageLimit(e.target.value)}
            />
          </div>
        </div>
        <CheckboxField label="Active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />

        {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save coupon'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
