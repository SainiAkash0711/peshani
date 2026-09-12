import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { TextField, TextAreaField, CheckboxField } from '../../components/FormField';
import { ShippingMethod } from '../../types/orders';

export interface ShippingMethodFormValues {
  name: string;
  code: string;
  description?: string;
  price: string;
  estimatedDeliveryDays?: number;
  isActive?: boolean;
  sortOrder?: number;
}

interface ShippingMethodFormModalProps {
  title: string;
  initial?: ShippingMethod;
  onSubmit: (values: ShippingMethodFormValues) => Promise<void>;
  onClose: () => void;
}

export function ShippingMethodFormModal({ title, initial, onSubmit, onClose }: ShippingMethodFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [price, setPrice] = useState(initial?.price ?? '');
  const [estimatedDeliveryDays, setEstimatedDeliveryDays] = useState(
    initial?.estimatedDeliveryDays != null ? String(initial.estimatedDeliveryDays) : '',
  );
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder != null ? String(initial.sortOrder) : '0');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim().length < 1 || code.trim().length < 1) {
      setError('Name and code are required');
      return;
    }
    if (price.trim().length < 1 || Number.isNaN(Number(price))) {
      setError('A valid price is required');
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        code: code.trim(),
        description: description.trim() || undefined,
        price: price.trim(),
        estimatedDeliveryDays: estimatedDeliveryDays.trim() ? Number(estimatedDeliveryDays) : undefined,
        sortOrder: sortOrder.trim() ? Number(sortOrder) : undefined,
        isActive,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} width={440}>
      <form onSubmit={handleSubmit}>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        <TextField label="Code" placeholder="e.g. STANDARD, EXPRESS" value={code} onChange={(e) => setCode(e.target.value)} required />
        <TextAreaField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <TextField
              label="Price"
              placeholder="e.g. 49.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </div>
          <div style={{ flex: 1 }}>
            <TextField
              label="Est. delivery days"
              type="number"
              min={0}
              value={estimatedDeliveryDays}
              onChange={(e) => setEstimatedDeliveryDays(e.target.value)}
            />
          </div>
        </div>
        <TextField label="Sort order" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        <CheckboxField label="Active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />

        {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save shipping method'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
