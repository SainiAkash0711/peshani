export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'HIDDEN';

export interface AdminReview {
  id: string;
  productId: string;
  productName: string;
  variantId: string | null;
  userId: string;
  customerEmail: string;
  customerName: string;
  orderId: string;
  orderItemId: string;
  rating: number;
  title: string | null;
  body: string;
  status: ReviewStatus;
  verifiedPurchase: boolean;
  moderatedByUserId: string | null;
  moderatedAt: string | null;
  moderationNote: string | null;
  createdAt: string;
  updatedAt: string;
}
