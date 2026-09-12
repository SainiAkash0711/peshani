import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { TextField, SelectField, CheckboxField } from '../../components/FormField';
import { Attribute, AttributeType } from '../../types/catalog';

export interface AttributeFormValues {
  name: string;
  slug?: string;
  type?: AttributeType;
  sortOrder?: number;
  isActive?: boolean;
}

interface AttributeFormModalProps {
  title: string;
  initial?: Attribute;
  onSubmit: (values: AttributeFormValues) => Promise<void>;
  onClose: () => void;
}

export function AttributeFormModal({ title, initial, onSubmit, onClose }: AttributeFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [type, setType] = useState<AttributeType>(initial?.type ?? 'SELECT');
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim().length < 1) {
      setError('Name is required');
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), slug: slug.trim() || undefined, type, sortOrder, isActive });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} width={440}>
      <form onSubmit={handleSubmit}>
        <TextField label="Attribute name" placeholder="e.g. Color" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        <TextField
          label="Slug"
          placeholder="auto-generated from name if left blank"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value as AttributeType)}>
          <option value="SELECT">Select (dropdown list)</option>
          <option value="COLOR">Color (swatch list)</option>
          <option value="TEXT">Text (descriptive only)</option>
          <option value="NUMBER">Number (descriptive only)</option>
        </SelectField>
        <TextField
          label="Display order"
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(Number(e.target.value))}
        />
        <CheckboxField label="Active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />

        {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save attribute'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
