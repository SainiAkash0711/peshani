export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description?: string | null;
  image?: string | null;
  bannerImage?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  sortOrder: number;
  isActive: boolean;
  isFeatured: boolean;
  createdAt: string;
  updatedAt: string;
  subcategoryCount?: number;
}

export interface CategoryTreeNode {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
  children: CategoryTreeNode[];
}

export interface Brand {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  logo?: string | null;
  website?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AttributeType = 'SELECT' | 'COLOR' | 'TEXT' | 'NUMBER';

export interface Attribute {
  id: string;
  name: string;
  slug: string;
  type: AttributeType;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AttributeValue {
  id: string;
  attributeId: string;
  value: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type BlogPostStatus = 'DRAFT' | 'PUBLISHED';

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  content: string;
  coverImageUrl?: string | null;
  authorName?: string | null;
  tags: string[];
  status: BlogPostStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProductVariantStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export interface VariantAttributeValueLabel {
  attributeId: string;
  attributeName: string;
  valueId: string;
  valueLabel: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  barcode?: string | null;
  price: string;
  compareAtPrice?: string | null;
  costPrice?: string | null;
  weight?: string | null;
  status: ProductVariantStatus;
  image?: string | null;
  attributeValues: VariantAttributeValueLabel[];
  createdAt: string;
  updatedAt: string;
}

export interface VariantAxis {
  attributeId: string;
  valueIds: string[];
}

export interface CombinationPreview {
  total: number;
  maxAllowed: number;
  exceedsLimit: boolean;
  combinations: { attributeValueIds: string[]; values: VariantAttributeValueLabel[] }[];
}

export interface GenerateVariantsResult {
  created: ProductVariant[];
  preserved: ProductVariant[];
  totalRequested: number;
}

export type ProductType = 'SIMPLE' | 'VARIABLE';
export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' | 'OUT_OF_STOCK';

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  productType: ProductType;
  status: ProductStatus;
  basePrice: string;
  brand: { id: string; name: string } | null;
  categories: { id: string; name: string }[];
  variantCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDetail extends ProductSummary {
  description?: string | null;
  shortDescription?: string | null;
  compareAtPrice?: string | null;
  costPrice?: string | null;
  taxClass?: string | null;
  weight?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  isFeatured: boolean;
  isBestseller: boolean;
  isNewArrival: boolean;
  publishedAt: string | null;
  tags: { id: string; name: string }[];
  attributes: { id: string; name: string; type: AttributeType }[];
}

export interface MediaImage {
  id: string;
  url: string;
  altText?: string | null;
  caption?: string | null;
  sortOrder: number;
  isPrimary: boolean;
  width?: number | null;
  height?: number | null;
  mimeType?: string | null;
}

export interface HomepageSlide {
  id: string;
  imageUrl: string;
  title: string | null;
  subtitle: string | null;
  linkUrl: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItem {
  id: string;
  warehouseId: string;
  productId: string;
  variantId?: string | null;
  onHandQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  committedQuantity: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  isOutOfStock: boolean;
  warehouse: { id: string; name: string; code: string };
  product: { id: string; name: string; sku: string | null; slug: string };
  variant: { id: string; sku: string } | null;
  updatedAt: string;
}

export type InventoryTransactionType =
  | 'INITIAL_STOCK'
  | 'STOCK_IN'
  | 'STOCK_OUT'
  | 'ADJUSTMENT'
  | 'RESERVATION'
  | 'RELEASE'
  | 'SALE'
  | 'RETURN'
  | 'DAMAGE'
  | 'TRANSFER';

export interface InventoryTransactionRecord {
  id: string;
  type: InventoryTransactionType;
  quantity: number;
  previousQuantity: number;
  newQuantity: number;
  reason?: string | null;
  reference?: string | null;
  createdAt: string;
  performedBy?: { id: string; email: string; firstName?: string | null; lastName?: string | null } | null;
}

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
