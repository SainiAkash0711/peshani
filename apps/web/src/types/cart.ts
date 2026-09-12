export type CartItemStatus =
  | 'VALID'
  | 'PRODUCT_UNAVAILABLE'
  | 'VARIANT_UNAVAILABLE'
  | 'OUT_OF_STOCK'
  | 'INSUFFICIENT_STOCK'
  | 'PRICE_CHANGED';

export interface CartLine {
  id: string;
  product: { id: string; name: string; slug: string; image: string | null };
  variant: { id: string; attributes: string[] } | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  status: CartItemStatus;
  priceChanged: boolean;
  availableQuantity?: number;
}

export interface CartResponse {
  id: string;
  currency: string;
  items: CartLine[];
  itemCount: number;
  subtotal: string;
  updatedAt: string;
}

export interface CartMergeResult {
  merged: string[];
  removed: { productId: string; variantId: string | null; reason: string }[];
  quantityAdjusted: { productId: string; variantId: string | null; requestedQuantity: number; adjustedQuantity: number }[];
  priceChanged: { productId: string; variantId: string | null; oldPrice: string; newPrice: string }[];
}
