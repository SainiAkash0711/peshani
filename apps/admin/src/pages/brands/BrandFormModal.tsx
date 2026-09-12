import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { TextField, TextAreaField, CheckboxField } from '../../components/FormField';
import { Brand } from '../../types/catalog';

export interface BrandFormValues {
  name: string;
  slug?: string;
  description?: string;
  logo?: string;
  website?: string;
  seoTitle?: string;
  seoDescription?: string;
  isActive?: boolean;
}

interface BrandFormModalProps {
  title: string;
  initial?: Brand;
  onSubmit: (values: BrandFormValues) => Promise<void>;
  onClose: () => void;
}

export function BrandFormModal({ title, initial, onSubmit, onClose }: BrandFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [logo, setLogo] = useState(initial?.logo ?? '');
  const [website, setWebsite] = useState(initial?.website ?? '');
  const [seoTitle, setSeoTitle] = useState(initial?.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(initial?.seoDescription ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim().length < 2) {
      setError('Name must be at least 2 characters');
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        slug: slug.trim() || undefined,
        description: description.trim() || undefined,
        logo: logo.trim() || undefined,
        website: website.trim() || undefined,
        seoTitle: seoTitle.trim() || undefined,
        seoDescription: seoDescription.trim() || undefined,
        isActive,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} width={520}>
      <form onSubmit={handleSubmit}>
        <TextField label="Brand name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        <TextField
          label="Slug"
          placeholder="auto-generated from name if left blank"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <TextAreaField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <TextField label="Website" placeholder="https://…" value={website} onChange={(e) => setWebsite(e.target.value)} />
        <TextField label="Logo URL" value={logo} onChange={(e) => setLogo(e.target.value)} />
        {logo && (
          <img
            src={logo}
            alt="Logo preview"
            style={{ maxHeight: 60, marginBottom: 14, borderRadius: 6, border: '1px solid #e5e7eb' }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
        )}
        <TextField label="SEO title" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} />
        <TextAreaField label="SEO description" value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} />
        <CheckboxField label="Active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />

        {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save brand'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
