export interface WishlistItemDetail {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  variantId: string | null;
  variantSku: string | null;
  price: string;
  image: string | null;
  isAvailable: boolean;
  createdAt: string;
}

export interface WishlistResponse {
  id: string;
  items: WishlistItemDetail[];
}
