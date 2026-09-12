import type { MetadataRoute } from 'next';
import { getSitemapProductsPage, getSitemapCategories, getSitemapBrands } from '../lib/api';
import { SITE_URL } from '../lib/site';

// Walking the full product catalog on every request would be wasteful given
// how large this catalog can get - the sitemap is regenerated at most once an
// hour. Categories/brands are small (a few hundred rows) so a single
// accumulated array is used for the whole sitemap rather than Next's
// generateSitemaps() chunking, which only pays off past tens of thousands of
// URLs.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/products`, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${SITE_URL}/categories`, changeFrequency: 'daily', priority: 0.7 },
    { url: `${SITE_URL}/brands`, changeFrequency: 'daily', priority: 0.7 },
  ];

  const [categories, brands] = await Promise.all([getSitemapCategories(), getSitemapBrands()]);

  for (const category of categories) {
    entries.push({
      url: `${SITE_URL}/categories/${category.slug}`,
      lastModified: category.updatedAt,
      changeFrequency: 'daily',
      priority: 0.6,
    });
  }

  for (const brand of brands) {
    entries.push({
      url: `${SITE_URL}/brands/${brand.slug}`,
      lastModified: brand.updatedAt,
      changeFrequency: 'daily',
      priority: 0.6,
    });
  }

  let cursor: string | undefined;
  do {
    const page = await getSitemapProductsPage(cursor);
    for (const product of page.items) {
      entries.push({
        url: `${SITE_URL}/products/${product.slug}`,
        lastModified: product.updatedAt,
        changeFrequency: 'daily',
        priority: 0.5,
      });
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return entries;
}
