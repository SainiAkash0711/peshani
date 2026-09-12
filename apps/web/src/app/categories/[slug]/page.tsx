import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getCategoryBySlug, getCategoryProducts, getStoreSettings } from '../../../lib/api';
import { Breadcrumbs } from '../../../components/Breadcrumbs';
import { ProductCard } from '../../../components/ProductCard';
import { Pagination } from '../../../components/Pagination';
import { absoluteUrl } from '../../../lib/site';
import { safeJsonLd } from '../../../lib/json-ld';

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

export async function generateMetadata({ params, searchParams }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const query = await searchParams;
  const category = await getCategoryBySlug(slug);
  if (!category) return {};

  const title = category.seoTitle ?? category.name;
  const description = category.seoDescription ?? category.description ?? undefined;
  const hasFilters = Object.keys(query).some((key) => !['page', 'sortBy', 'sortOrder'].includes(key));

  return {
    title,
    description,
    alternates: { canonical: `/categories/${slug}` },
    openGraph: { title, description },
    ...(hasFilters ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const page = Number(query.page ?? '1');

  const [category, settings] = await Promise.all([getCategoryBySlug(slug), getStoreSettings()]);
  if (!category) notFound();

  const products = await getCategoryProducts(slug, {
    page,
    sortBy: (query.sortBy as 'name' | 'price' | 'createdAt' | undefined) ?? 'createdAt',
    sortOrder: (query.sortOrder as 'asc' | 'desc' | undefined) ?? 'desc',
  });

  const breadcrumbItems = [
    { label: 'Categories', href: '/categories' },
    ...category.breadcrumbs.slice(0, -1).map((b) => ({ label: b.name, href: `/categories/${b.slug}` })),
    { label: category.name },
  ];

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ label: 'Home', href: '/' }, ...breadcrumbItems].map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      ...(item.href ? { item: absoluteUrl(item.href) } : {}),
    })),
  };

  return (
    <main className="container">
      <Breadcrumbs items={breadcrumbItems} />
      <h1 style={{ marginBottom: 8 }}>{category.name}</h1>
      {category.description && <p style={{ color: 'var(--color-text-muted)', marginBottom: 24 }}>{category.description}</p>}

      {category.children.length > 0 && (
        <div className="category-grid" style={{ marginBottom: 32 }}>
          {category.children.map((child) => (
            <Link key={child.id} href={`/categories/${child.slug}`} className="category-tile">
              {child.name}
            </Link>
          ))}
        </div>
      )}

      {!products || products.items.length === 0 ? (
        <div className="empty-state">No products found in this category yet.</div>
      ) : (
        <>
          <div className="grid">
            {products.items.map((product) => (
              <ProductCard key={product.id} product={product} currencySymbol={settings.currencySymbol} />
            ))}
          </div>
          <Pagination pagination={products.pagination} basePath={`/categories/${slug}`} currentParams={query} />
        </>
      )}
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }} />
    </main>
  );
}
