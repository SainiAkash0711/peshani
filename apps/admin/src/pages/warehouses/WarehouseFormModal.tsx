import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { TextField, CheckboxField } from '../../components/FormField';
import { Warehouse } from '../../types/catalog';

export interface WarehouseFormValues {
  name: string;
  code: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  isDefault?: boolean;
}

interface WarehouseFormModalProps {
  title: string;
  initial?: Warehouse;
  onSubmit: (values: WarehouseFormValues) => Promise<void>;
  onClose: () => void;
}

export function WarehouseFormModal({ title, initial, onSubmit, onClose }: WarehouseFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [addressLine1, setAddressLine1] = useState(initial?.addressLine1 ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [state, setState] = useState(initial?.state ?? '');
  const [country, setCountry] = useState(initial?.country ?? '');
  const [postalCode, setPostalCode] = useState(initial?.postalCode ?? '');
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim().length < 1 || code.trim().length < 1) {
      setError('Name and code are required');
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        code: code.trim(),
        addressLine1: addressLine1.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        country: country.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        isDefault,
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
        <TextField label="Warehouse name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        <TextField label="Code" placeholder="e.g. MAIN, DELHI-1" value={code} onChange={(e) => setCode(e.target.value)} required />
        <TextField label="Address" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <TextField label="City" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <TextField label="State" value={state} onChange={(e) => setState(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <TextField label="Country" value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <TextField label="Postal code" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
          </div>
        </div>
        <CheckboxField label="Default warehouse" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />

        {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save warehouse'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
