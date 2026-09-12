import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { TextField, TextAreaField, SelectField, CheckboxField } from '../../components/FormField';
import { Category, CategoryTreeNode } from '../../types/catalog';
import { collectSubtreeIds, flattenTree } from '../../lib/category-tree';

export interface CategoryFormValues {
  name: string;
  slug?: string;
  description?: string;
  parentId?: string | null;
  image?: string;
  bannerImage?: string;
  seoTitle?: string;
  seoDescription?: string;
  sortOrder?: number;
  isActive?: boolean;
  isFeatured?: boolean;
}

// Categories and subcategories are the same underlying record (a Category
// with or without a parentId) - this mode only controls the form's own
// presentation, not a different backend concept:
//   - 'category': no category selector at all - always top-level, whether
//     creating or editing (used only from the Categories page).
//   - 'subcategory': a required "Category" selector is always shown - a
//     subcategory always belongs to exactly one category (used only from
//     the Subcategories page).
export type CategoryFormMode = 'category' | 'subcategory';

interface CategoryFormModalProps {
  title: string;
  mode: CategoryFormMode;
  initial?: Category;
  tree: CategoryTreeNode[];
  onSubmit: (values: CategoryFormValues) => Promise<void>;
  onClose: () => void;
}

export function CategoryFormModal({ title, mode, initial, tree, onSubmit, onClose }: CategoryFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [parentId, setParentId] = useState(initial?.parentId ?? '');
  const [image, setImage] = useState(initial?.image ?? '');
  const [bannerImage, setBannerImage] = useState(initial?.bannerImage ?? '');
  const [seoTitle, setSeoTitle] = useState(initial?.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(initial?.seoDescription ?? '');
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [isFeatured, setIsFeatured] = useState(initial?.isFeatured ?? false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Editing a subcategory can't offer itself or its own descendants as its
  // own category - the server would reject it as a cycle anyway, but
  // filtering it out here means the admin never has to discover that by
  // trial and error.
  const excludedIds = initial ? collectSubtreeIds(tree, initial.id) : new Set<string>();
  const categoryOptions = flattenTree(tree).filter((opt) => !excludedIds.has(opt.id));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim().length < 2) {
      setError('Name must be at least 2 characters');
      return;
    }
    if (mode === 'subcategory' && !parentId) {
      setError('Choose which category this subcategory belongs under');
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        slug: slug.trim() || undefined,
        description: description.trim() || undefined,
        parentId: mode === 'category' ? null : parentId,
        image: image.trim() || undefined,
        bannerImage: bannerImage.trim() || undefined,
        seoTitle: seoTitle.trim() || undefined,
        seoDescription: seoDescription.trim() || undefined,
        sortOrder,
        isActive,
        isFeatured,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} width={560}>
      <form onSubmit={handleSubmit}>
        <TextField
          label={mode === 'subcategory' ? 'Subcategory name' : 'Category name'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
        <TextField
          label="Slug"
          placeholder="auto-generated from name if left blank"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <TextAreaField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />

        {mode === 'subcategory' && (
          <SelectField label="Category" value={parentId} onChange={(e) => setParentId(e.target.value)} required>
            <option value="" disabled>
              Choose a category…
            </option>
            {categoryOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {'—'.repeat(opt.depth)} {opt.name}
              </option>
            ))}
          </SelectField>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <TextField label="Image URL" value={image} onChange={(e) => setImage(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <TextField label="Banner image URL" value={bannerImage} onChange={(e) => setBannerImage(e.target.value)} />
          </div>
        </div>
        <TextField label="SEO title" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} />
        <TextAreaField label="SEO description" value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} />
        <TextField
          label="Display order"
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(Number(e.target.value))}
        />
        <CheckboxField label="Active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        <CheckboxField label="Featured" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} />

        {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
