import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getProductBySlug, getStoreSettings } from '../../../lib/api';
import { Breadcrumbs } from '../../../components/Breadcrumbs';
import { ProductDetailInteractive } from '../../../components/ProductDetailInteractive';
import { absoluteUrl } from '../../../lib/site';
import { safeJsonLd } from '../../../lib/json-ld';

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return {};
  const title = product.seoTitle ?? product.name;
  const description = product.seoDescription ?? product.shortDescription ?? undefined;
  const imageUrl = product.primaryImage ? absoluteUrl(product.primaryImage.url) : undefined;
  return {
    title,
    description,
    alternates: { canonical: `/products/${slug}` },
    openGraph: {
      title,
      description,
      images: imageUrl ? [imageUrl] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: imageUrl ? [imageUrl] : undefined,
    },
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const [product, settings] = await Promise.all([getProductBySlug(slug), getStoreSettings()]);
  if (!product) notFound();

  const breadcrumbItems = [
    { label: 'All Products', href: '/products' },
    ...(product.categories[0] ? [{ label: product.categories[0].name, href: `/categories/${product.categories[0].slug}` }] : []),
    { label: product.name },
  ];

  const productJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description ?? product.shortDescription ?? undefined,
    image: product.images.map((img) => absoluteUrl(img.url)),
    brand: product.brand ? { '@type': 'Brand', name: product.brand.name } : undefined,
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: settings.currency ?? 'INR',
      lowPrice: product.priceRange?.min ?? product.basePrice,
      highPrice: product.priceRange?.max ?? product.basePrice,
      availability:
        product.availability === 'OUT_OF_STOCK' ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
    },
  };

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
      <ProductDetailInteractive product={product} currencySymbol={settings.currencySymbol} />
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(productJsonLd) }} />
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }} />
    </main>
  );
}
