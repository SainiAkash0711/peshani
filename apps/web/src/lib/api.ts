import type {
  BrandDetail,
  BrandSummary,
  CategoryDetail,
  CategoryTreeNode,
  HomePageData,
  PaginatedResult,
  ProductDetail,
  ProductListItem,
  StoreSettings,
} from '../types/catalog';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

/**
 * Every call here hits a @Public() Phase 3 storefront endpoint - no auth
 * header, ever. `revalidate` mirrors the API's own Cache-Control max-age
 * (see the storefront controllers) so the two caching layers agree.
 *
 * A network-level failure (API unreachable - refused connection, DNS, etc.)
 * degrades to the same "not found" result a real 404 would, rather than
 * crashing the page: every caller already falls back to an empty/default
 * value in that case. An HTTP error response (400/500) still throws, since
 * that's a real bug worth surfacing, not something to hide.
 */
async function getJson<T>(path: string, revalidate: number): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { next: { revalidate } });
  } catch {
    return null;
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Storefront API request to ${path} failed with ${res.status}`);
  return res.json() as Promise<T>;
}

function toQueryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, string | number | boolean | undefined>)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export async function getStoreSettings(): Promise<StoreSettings> {
  const settings = await getJson<StoreSettings>('/store-settings', 300);
  return settings ?? { storeName: 'Peshani' };
}

export async function getHomePage(): Promise<HomePageData> {
  // Short cache, not the 60s used elsewhere on this storefront: this
  // payload includes the admin-managed homepage slider, which should
  // reflect an add/edit/delete quickly, not up to a full minute later.
  const data = await getJson<HomePageData>('/storefront/home', 10);
  return data ?? { slides: [], featuredProducts: [], bestsellers: [], newArrivals: [], featuredCategories: [], brands: [] };
}

export interface ProductListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: 'name' | 'price' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
  categorySlug?: string;
  brandSlug?: string;
  minPrice?: number;
  maxPrice?: number;
}

export async function getProducts(params: ProductListParams = {}): Promise<PaginatedResult<ProductListItem>> {
  const data = await getJson<PaginatedResult<ProductListItem>>(`/storefront/products${toQueryString(params)}`, 60);
  return data ?? { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } };
}

export async function getProductBySlug(slug: string): Promise<ProductDetail | null> {
  return getJson<ProductDetail>(`/storefront/products/${encodeURIComponent(slug)}`, 60);
}

export async function getCategoryTree(): Promise<CategoryTreeNode[]> {
  // Short cache: this feeds the homepage mega menu, which should reflect an
  // admin category/subcategory add-rename-delete quickly, not up to 5
  // minutes later (see the homepage slider's identical revalidate choice).
  const data = await getJson<CategoryTreeNode[]>('/storefront/categories', 30);
  return data ?? [];
}

export async function getCategoryBySlug(slug: string): Promise<CategoryDetail | null> {
  return getJson<CategoryDetail>(`/storefront/categories/${encodeURIComponent(slug)}`, 30);
}

export async function getCategoryProducts(
  slug: string,
  params: Omit<ProductListParams, 'categorySlug' | 'brandSlug'> = {},
): Promise<PaginatedResult<ProductListItem> | null> {
  return getJson<PaginatedResult<ProductListItem>>(
    `/storefront/categories/${encodeURIComponent(slug)}/products${toQueryString(params)}`,
    60,
  );
}

export async function getBrands(params: { page?: number; pageSize?: number; search?: string } = {}): Promise<PaginatedResult<BrandSummary>> {
  const data = await getJson<PaginatedResult<BrandSummary>>(`/storefront/brands${toQueryString(params)}`, 300);
  return data ?? { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } };
}

export async function getBrandBySlug(slug: string): Promise<BrandDetail | null> {
  return getJson<BrandDetail>(`/storefront/brands/${encodeURIComponent(slug)}`, 300);
}

export async function getBrandProducts(
  slug: string,
  params: Omit<ProductListParams, 'categorySlug' | 'brandSlug'> = {},
): Promise<PaginatedResult<ProductListItem> | null> {
  return getJson<PaginatedResult<ProductListItem>>(`/storefront/brands/${encodeURIComponent(slug)}/products${toQueryString(params)}`, 60);
}

export interface SearchParams {
  q?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'relevance' | 'newest' | 'price_asc' | 'price_desc' | 'name_asc' | 'name_desc';
  categorySlug?: string;
  brandSlug?: string;
  minPrice?: number;
  maxPrice?: number;
  availability?: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  attributeValueIds?: string;
}

export async function searchProducts(params: SearchParams = {}): Promise<PaginatedResult<ProductListItem>> {
  const data = await getJson<PaginatedResult<ProductListItem>>(`/storefront/search${toQueryString(params)}`, 30);
  return data ?? { items: [], pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1 } };
}

export interface SitemapEntry {
  slug: string;
  updatedAt: string;
}

export interface SitemapProductsPage {
  items: SitemapEntry[];
  nextCursor: string | null;
}

export async function getSitemapProductsPage(cursor?: string, limit?: number): Promise<SitemapProductsPage> {
  const data = await getJson<SitemapProductsPage>(`/storefront/sitemap/products${toQueryString({ cursor, limit })}`, 300);
  return data ?? { items: [], nextCursor: null };
}

export async function getSitemapCategories(): Promise<SitemapEntry[]> {
  const data = await getJson<{ items: SitemapEntry[] }>('/storefront/sitemap/categories', 300);
  return data?.items ?? [];
}

export async function getSitemapBrands(): Promise<SitemapEntry[]> {
  const data = await getJson<{ items: SitemapEntry[] }>('/storefront/sitemap/brands', 300);
  return data?.items ?? [];
}
