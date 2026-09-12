export type Availability = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
export type ProductType = 'SIMPLE' | 'VARIABLE';

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image: string | null;
  isFeatured: boolean;
}

export interface CategoryTreeNode extends CategorySummary {
  children: CategoryTreeNode[];
}

export interface CategoryDetail extends CategorySummary {
  bannerImage: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  breadcrumbs: CategorySummary[];
  children: CategorySummary[];
}

export interface BrandSummary {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
}

export interface BrandDetail extends BrandSummary {
  description: string | null;
  website: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface ProductImageRef {
  url: string;
  altText: string | null;
}

export interface ProductListItem {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  productType: ProductType;
  basePrice: string;
  compareAtPrice: string | null;
  priceRange?: { min: string; max: string };
  isFeatured: boolean;
  isBestseller: boolean;
  isNewArrival: boolean;
  createdAt: string;
  brand: BrandSummary | null;
  categories: CategorySummary[];
  primaryImage: ProductImageRef | null;
  availability: Availability;
}

export interface ProductVariantOption {
  attributeId: string;
  attributeName: string;
  type: string;
  values: { valueId: string; label: string }[];
}

export interface ProductVariantDetail {
  id: string;
  sku: string;
  price: string;
  compareAtPrice: string | null;
  image: string | null;
  images: ProductImageRef[];
  availability: Availability;
  attributeValueIds: string[];
}

export interface ProductDetail extends ProductListItem {
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  images: (ProductImageRef & { caption: string | null; sortOrder: number })[];
  options: ProductVariantOption[];
  variants: ProductVariantDetail[];
}

export interface StoreSettings {
  storeName: string;
  storeDescription?: string;
  currency?: string;
  currencySymbol?: string;
  supportEmail?: string;
  supportPhone?: string;
  [key: string]: string | undefined;
}

export interface HomepageSlide {
  id: string;
  imageUrl: string;
  title: string | null;
  subtitle: string | null;
  linkUrl: string | null;
}

export interface HomePageData {
  slides: HomepageSlide[];
  featuredProducts: ProductListItem[];
  bestsellers: ProductListItem[];
  newArrivals: ProductListItem[];
  featuredCategories: CategorySummary[];
  brands: BrandSummary[];
}
