import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getBrandBySlug, getBrandProducts, getStoreSettings } from '../../../lib/api';
import { Breadcrumbs } from '../../../components/Breadcrumbs';
import { ProductCard } from '../../../components/ProductCard';
import { Pagination } from '../../../components/Pagination';
import { absoluteUrl } from '../../../lib/site';
import { safeJsonLd } from '../../../lib/json-ld';

interface BrandPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

export async function generateMetadata({ params, searchParams }: BrandPageProps): Promise<Metadata> {
  const { slug } = await params;
  const query = await searchParams;
  const brand = await getBrandBySlug(slug);
  if (!brand) return {};

  const title = brand.seoTitle ?? brand.name;
  const description = brand.seoDescription ?? brand.description ?? undefined;
  const hasFilters = Object.keys(query).some((key) => !['page', 'sortBy', 'sortOrder'].includes(key));

  return {
    title,
    description,
    alternates: { canonical: `/brands/${slug}` },
    openGraph: { title, description },
    ...(hasFilters ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function BrandPage({ params, searchParams }: BrandPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const page = Number(query.page ?? '1');

  const [brand, settings] = await Promise.all([getBrandBySlug(slug), getStoreSettings()]);
  if (!brand) notFound();

  const products = await getBrandProducts(slug, {
    page,
    sortBy: (query.sortBy as 'name' | 'price' | 'createdAt' | undefined) ?? 'createdAt',
    sortOrder: (query.sortOrder as 'asc' | 'desc' | undefined) ?? 'desc',
  });

  const breadcrumbItems = [{ label: 'Brands', href: '/brands' }, { label: brand.name }];

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
      <h1 style={{ marginBottom: 8 }}>{brand.name}</h1>
      {brand.description && <p style={{ color: 'var(--color-text-muted)', marginBottom: 24 }}>{brand.description}</p>}

      {!products || products.items.length === 0 ? (
        <div className="empty-state">No products found for this brand yet.</div>
      ) : (
        <>
          <div className="grid">
            {products.items.map((product) => (
              <ProductCard key={product.id} product={product} currencySymbol={settings.currencySymbol} />
            ))}
          </div>
          <Pagination pagination={products.pagination} basePath={`/brands/${slug}`} currentParams={query} />
        </>
      )}
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }} />
    </main>
  );
}
