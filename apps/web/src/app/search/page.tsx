import Link from 'next/link';
import type { Metadata } from 'next';
import { searchProducts, getCategoryTree, getBrands, getStoreSettings, type SearchParams } from '../../lib/api';
import type { CategoryTreeNode, PaginatedResult, ProductListItem } from '../../types/catalog';
import { ProductCard } from '../../components/ProductCard';
import { SearchToolbar } from '../../components/SearchToolbar';
import { Pagination } from '../../components/Pagination';
import { Breadcrumbs } from '../../components/Breadcrumbs';

interface SearchPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const params = await searchParams;
  const q = params.q?.trim();
  return {
    title: q ? `Search results for "${q}"` : 'Search',
    robots: { index: false, follow: true },
  };
}

function flattenCategories(nodes: CategoryTreeNode[]): { slug: string; name: string }[] {
  return nodes.flatMap((node) => [{ slug: node.slug, name: node.name }, ...flattenCategories(node.children)]);
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const q = params.q?.trim();
  const page = Number(params.page ?? '1');
  const sortBy = (params.sortBy as SearchParams['sortBy']) ?? 'relevance';
  const minPrice = params.minPrice ? Number(params.minPrice) : undefined;
  const maxPrice = params.maxPrice ? Number(params.maxPrice) : undefined;

  const [settings, categoryTree, brands] = await Promise.all([
    getStoreSettings(),
    getCategoryTree(),
    getBrands({ pageSize: 100 }),
  ]);
  const categories = flattenCategories(categoryTree);

  let result: PaginatedResult<ProductListItem> | null = null;
  let error: string | null = null;
  try {
    result = await searchProducts({
      q,
      page,
      sortBy,
      categorySlug: params.categorySlug,
      brandSlug: params.brandSlug,
      minPrice,
      maxPrice,
      availability: params.availability as SearchParams['availability'],
    });
  } catch {
    error = 'We could not run that search. Please adjust your filters and try again.';
  }

  return (
    <main className="container">
      <Breadcrumbs items={[{ label: 'Search' }]} />
      <h1 style={{ marginBottom: 8 }}>{q ? `Search results for "${q}"` : 'Search'}</h1>
      <SearchToolbar resultCount={result?.pagination.total ?? 0} categories={categories} brands={brands.items} />

      {error ? (
        <div className="empty-state">{error}</div>
      ) : !result || result.items.length === 0 ? (
        <div className="empty-state">
          No products found.{' '}
          <Link href="/products">Browse all products</Link> or <Link href="/categories">explore categories</Link>.
        </div>
      ) : (
        <>
          <div className="grid">
            {result.items.map((product) => (
              <ProductCard key={product.id} product={product} currencySymbol={settings.currencySymbol} />
            ))}
          </div>
          <Pagination pagination={result.pagination} basePath="/search" currentParams={params} />
        </>
      )}
    </main>
  );
}
