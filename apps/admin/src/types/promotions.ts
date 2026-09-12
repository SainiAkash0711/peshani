export type DiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT';

export interface PromotionSummary {
  id: string;
  name: string;
  description?: string | null;
  discountType: DiscountType;
  value: string;
  maximumDiscountAmount: string | null;
  minimumOrderAmount: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromotionTargetingIds {
  productIds: string[];
  excludedProductIds: string[];
  categoryIds: string[];
  excludedCategoryIds: string[];
  brandIds: string[];
  excludedBrandIds: string[];
}

export interface PromotionDetail extends PromotionSummary, PromotionTargetingIds {}

export interface CouponSummary {
  id: string;
  promotionId: string;
  code: string;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  perCustomerUsageLimit: number | null;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}
