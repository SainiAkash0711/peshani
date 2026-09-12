import type { Metadata } from 'next';
import { getProducts, getStoreSettings } from '../../lib/api';
import { ProductCard } from '../../components/ProductCard';
import { ProductToolbar } from '../../components/ProductToolbar';
import { Pagination } from '../../components/Pagination';
import { Breadcrumbs } from '../../components/Breadcrumbs';

interface ProductsPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export async function generateMetadata({ searchParams }: ProductsPageProps): Promise<Metadata> {
  const params = await searchParams;
  const hasFilters = Boolean(params.search || params.categorySlug || params.brandSlug || params.minPrice || params.maxPrice);
  const page = Number(params.page ?? '1');

  return {
    title: 'All Products',
    alternates: { canonical: page > 1 ? `/products?page=${page}` : '/products' },
    ...(hasFilters ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const params = await searchParams;
  const page = Number(params.page ?? '1');
  const sortBy = (params.sortBy as 'name' | 'price' | 'createdAt' | undefined) ?? 'createdAt';
  const sortOrder = (params.sortOrder as 'asc' | 'desc' | undefined) ?? 'desc';

  const [settings, result] = await Promise.all([
    getStoreSettings(),
    getProducts({
      page,
      search: params.search,
      sortBy,
      sortOrder,
      categorySlug: params.categorySlug,
      brandSlug: params.brandSlug,
    }),
  ]);

  return (
    <main className="container">
      <Breadcrumbs items={[{ label: 'All Products' }]} />
      <ProductToolbar resultCount={result.pagination.total} />
      {result.items.length === 0 ? (
        <div className="empty-state">No products found.</div>
      ) : (
        <div className="grid">
          {result.items.map((product) => (
            <ProductCard key={product.id} product={product} currencySymbol={settings.currencySymbol} />
          ))}
        </div>
      )}
      <Pagination pagination={result.pagination} basePath="/products" currentParams={params} />
    </main>
  );
}
