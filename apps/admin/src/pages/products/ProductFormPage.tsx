import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { TextField, TextAreaField, SelectField, CheckboxField } from '../../components/FormField';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { cardStyle, pageHeaderStyle } from '../../styles';
import { Brand, Category, PaginatedResult, ProductDetail, ProductType, Attribute } from '../../types/catalog';
import { ProductVariantsSection } from './ProductVariantsSection';
import { MediaGallery } from '../../components/media/MediaGallery';

interface FormState {
  name: string;
  slug: string;
  productType: ProductType;
  sku: string;
  basePrice: string;
  compareAtPrice: string;
  costPrice: string;
  weight: string;
  taxClass: string;
  description: string;
  shortDescription: string;
  brandId: string;
  categoryIds: string[];
  tagNames: string;
  attributeIds: string[];
  seoTitle: string;
  seoDescription: string;
  isFeatured: boolean;
  isBestseller: boolean;
  isNewArrival: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  slug: '',
  productType: 'SIMPLE',
  sku: '',
  basePrice: '',
  compareAtPrice: '',
  costPrice: '',
  weight: '',
  taxClass: '',
  description: '',
  shortDescription: '',
  brandId: '',
  categoryIds: [],
  tagNames: '',
  attributeIds: [],
  seoTitle: '',
  seoDescription: '',
  isFeatured: false,
  isBestseller: false,
  isNewArrival: false,
};

function detailToForm(product: ProductDetail): FormState {
  return {
    name: product.name,
    slug: product.slug,
    productType: product.productType,
    sku: product.sku ?? '',
    basePrice: product.basePrice,
    compareAtPrice: product.compareAtPrice ?? '',
    costPrice: product.costPrice ?? '',
    weight: product.weight ?? '',
    taxClass: product.taxClass ?? '',
    description: product.description ?? '',
    shortDescription: product.shortDescription ?? '',
    brandId: product.brand?.id ?? '',
    categoryIds: product.categories.map((c) => c.id),
    tagNames: product.tags.map((t) => t.name).join(', '),
    attributeIds: product.attributes.map((a) => a.id),
    seoTitle: product.seoTitle ?? '',
    seoDescription: product.seoDescription ?? '',
    isFeatured: product.isFeatured,
    isBestseller: product.isBestseller,
    isNewArrival: product.isNewArrival,
  };
}

export function ProductFormPage() {
  const { id } = useParams();
  const isEditing = !!id;
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [initialForm, setInitialForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  // Which top-level Category is currently selected in the cascading
  // Category -> Subcategory picker below. form.categoryIds (the actual
  // submitted value) always holds [selectedCategoryId, ...checked
  // subcategory ids] - this is purely UI state to drive which
  // subcategories are shown as checkboxes.
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [categorySelectionInitialized, setCategorySelectionInitialized] = useState(false);

  const productQuery = useQuery({
    queryKey: ['products', 'detail', id],
    queryFn: () => apiClient.get<ProductDetail>(`/products/${id}`),
    enabled: isEditing,
  });

  useEffect(() => {
    if (productQuery.data) {
      const next = detailToForm(productQuery.data);
      setForm(next);
      setInitialForm(next);
    }
  }, [productQuery.data]);

  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialForm), [form, initialForm]);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty) {
        e.preventDefault();
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const brandsQuery = useQuery({
    queryKey: ['brands', 'for-product-form'],
    queryFn: () => apiClient.get<PaginatedResult<Brand>>('/brands?pageSize=100&status=active'),
  });
  const categoriesQuery = useQuery({
    queryKey: ['categories', 'for-product-form'],
    queryFn: () => apiClient.get<PaginatedResult<Category>>('/categories?pageSize=100&status=active'),
  });

  const allCategories = categoriesQuery.data?.items ?? [];
  const topLevelCategories = allCategories.filter((c) => !c.parentId);
  const subcategoriesOfSelected = allCategories.filter((c) => c.parentId === selectedCategoryId);

  // Runs once, as soon as the categories list (and, when editing, the
  // product itself) have loaded - derives which top-level category the
  // product's existing categoryIds belong under, from the raw id list
  // detailToForm produced. A brand-new product simply starts with nothing
  // selected.
  useEffect(() => {
    if (categorySelectionInitialized || allCategories.length === 0) return;
    if (isEditing && !productQuery.data) return;
    const categoryById = new Map(allCategories.map((c) => [c.id, c]));
    const topLevelId = form.categoryIds.find((id) => categoryById.get(id) && !categoryById.get(id)!.parentId);
    const inferredTopLevelId =
      topLevelId ?? categoryById.get(form.categoryIds.find((id) => categoryById.get(id)?.parentId) ?? '')?.parentId ?? '';
    setSelectedCategoryId(inferredTopLevelId);
    setCategorySelectionInitialized(true);
  }, [allCategories, categorySelectionInitialized, isEditing, productQuery.data, form.categoryIds]);

  function handleCategoryChange(categoryId: string) {
    setSelectedCategoryId(categoryId);
    setForm((prev) => ({ ...prev, categoryIds: categoryId ? [categoryId] : [] }));
  }

  function toggleSubcategory(subcategoryId: string) {
    setForm((prev) => ({
      ...prev,
      categoryIds: prev.categoryIds.includes(subcategoryId)
        ? prev.categoryIds.filter((c) => c !== subcategoryId)
        : [...prev.categoryIds, subcategoryId],
    }));
  }
  const attributesQuery = useQuery({
    queryKey: ['attributes', 'for-product-form'],
    queryFn: () => apiClient.get<PaginatedResult<Attribute>>('/attributes?pageSize=100&status=active'),
  });

  function buildDto() {
    return {
      name: form.name,
      slug: form.slug || undefined,
      ...(isEditing ? {} : { productType: form.productType }),
      sku: form.productType === 'SIMPLE' ? form.sku || undefined : undefined,
      basePrice: form.basePrice,
      compareAtPrice: form.compareAtPrice || undefined,
      costPrice: form.costPrice || undefined,
      weight: form.weight || undefined,
      taxClass: form.taxClass || undefined,
      description: form.description || undefined,
      shortDescription: form.shortDescription || undefined,
      brandId: form.brandId || null,
      categoryIds: form.categoryIds,
      tagNames: form.tagNames
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      attributeIds: form.attributeIds,
      seoTitle: form.seoTitle || undefined,
      seoDescription: form.seoDescription || undefined,
      isFeatured: form.isFeatured,
      isBestseller: form.isBestseller,
      isNewArrival: form.isNewArrival,
    };
  }

  const createMutation = useMutation({
    mutationFn: () => apiClient.post<ProductDetail>('/products', buildDto()),
    onSuccess: (product) => {
      toast.show('success', 'Product created');
      setInitialForm(form);
      navigate(`/products/${product.id}/edit`, { replace: true });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create product'),
  });

  const updateMutation = useMutation({
    mutationFn: () => apiClient.patch<ProductDetail>(`/products/${id}`, buildDto()),
    onSuccess: (product) => {
      toast.show('success', 'Product saved');
      setForm(detailToForm(product));
      setInitialForm(detailToForm(product));
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to save product'),
  });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (isEditing) {
      await updateMutation.mutateAsync();
    } else {
      await createMutation.mutateAsync();
    }
  }

  function toggleAttribute(attributeId: string) {
    setForm((prev) => ({
      ...prev,
      attributeIds: prev.attributeIds.includes(attributeId)
        ? prev.attributeIds.filter((a) => a !== attributeId)
        : [...prev.attributeIds, attributeId],
    }));
  }

  function handleBack() {
    if (isDirty) {
      setConfirmingLeave(true);
    } else {
      navigate('/products');
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isEditing && productQuery.isLoading) {
    return <p style={{ color: '#9ca3af' }}>Loading…</p>;
  }

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{isEditing ? `Edit ${initialForm.name || 'Product'}` : 'New Product'}</h1>
        <Button variant="secondary" onClick={handleBack}>
          {isDirty ? 'Back (unsaved changes)' : 'Back to Products'}
        </Button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Basic information</h3>
          <TextField label="Product name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
          <TextField label="Slug" placeholder="auto-generated if left blank" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          <SelectField
            label="Product type"
            value={form.productType}
            disabled={isEditing}
            onChange={(e) => setForm({ ...form, productType: e.target.value as ProductType })}
          >
            <option value="SIMPLE">Simple (single SKU/price)</option>
            <option value="VARIABLE">Variable (uses variants)</option>
          </SelectField>
          {isEditing && <p style={{ fontSize: 12, color: '#9ca3af', marginTop: -8 }}>Product type can't be changed after creation.</p>}
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Description</h3>
          <TextField label="Short description" value={form.shortDescription} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} />
          <TextAreaField label="Full description" rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Pricing</h3>
          {form.productType === 'SIMPLE' && (
            <TextField label="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required />
          )}
          {form.productType === 'VARIABLE' && (
            <p style={{ fontSize: 12, color: '#9ca3af' }}>SKU and price are set per-variant below.</p>
          )}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <TextField label="Base price" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} required />
            </div>
            <div style={{ flex: 1 }}>
              <TextField label="Compare-at price" value={form.compareAtPrice} onChange={(e) => setForm({ ...form, compareAtPrice: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <TextField label="Cost price" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <TextField label="Weight (kg)" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <TextField label="Tax class" value={form.taxClass} onChange={(e) => setForm({ ...form, taxClass: e.target.value })} />
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Organization</h3>
          <SelectField label="Brand" value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })}>
            <option value="">— No brand —</option>
            {brandsQuery.data?.items.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Category" value={selectedCategoryId} onChange={(e) => handleCategoryChange(e.target.value)}>
            <option value="">— No category —</option>
            {topLevelCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          {selectedCategoryId && subcategoriesOfSelected.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Subcategories</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {subcategoriesOfSelected.map((c) => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                    <input type="checkbox" checked={form.categoryIds.includes(c.id)} onChange={() => toggleSubcategory(c.id)} />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <TextField
            label="Tags (comma-separated)"
            placeholder="summer, trending, sale"
            value={form.tagNames}
            onChange={(e) => setForm({ ...form, tagNames: e.target.value })}
          />
        </div>

        {form.productType === 'VARIABLE' && (
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Variant attributes</h3>
            <p style={{ fontSize: 12, color: '#9ca3af', marginTop: -8 }}>Which attributes define this product's variants.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {attributesQuery.data?.items.map((a) => (
                <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                  <input type="checkbox" checked={form.attributeIds.includes(a.id)} onChange={() => toggleAttribute(a.id)} />
                  {a.name}
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Media</h3>
          {isEditing && id ? (
            <MediaGallery basePath={`/products/${id}/images`} queryKey={['product-images', id]} />
          ) : (
            <p style={{ fontSize: 12, color: '#9ca3af' }}>Save this product first to unlock image uploads.</p>
          )}
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>SEO</h3>
          <TextField label="SEO title" value={form.seoTitle} onChange={(e) => setForm({ ...form, seoTitle: e.target.value })} />
          <TextAreaField label="SEO description" value={form.seoDescription} onChange={(e) => setForm({ ...form, seoDescription: e.target.value })} />
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Publishing</h3>
          <CheckboxField label="Featured" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} />
          <CheckboxField label="Bestseller" checked={form.isBestseller} onChange={(e) => setForm({ ...form, isBestseller: e.target.checked })} />
          <CheckboxField label="New arrival" checked={form.isNewArrival} onChange={(e) => setForm({ ...form, isNewArrival: e.target.checked })} />
        </div>

        {error && <p style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}

        <div>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? 'Saving…' : isEditing ? 'Save changes' : 'Create product'}
          </Button>
        </div>
      </form>

      {isEditing && form.productType === 'VARIABLE' && id && (
        <div style={{ marginTop: 16 }}>
          <ProductVariantsSection productId={id} />
        </div>
      )}

      {!isEditing && form.productType === 'VARIABLE' && (
        <p style={{ marginTop: 16, color: '#9ca3af', fontSize: 13 }}>
          Save this product first to unlock variant generation.
        </p>
      )}

      {confirmingLeave && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          message="You have unsaved changes. Leaving now will discard them."
          confirmLabel="Discard and leave"
          danger
          onConfirm={() => navigate('/products')}
          onCancel={() => setConfirmingLeave(false)}
        />
      )}
    </div>
  );
}
