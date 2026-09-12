export interface CouponValidationResult {
  couponCode: string;
  promotionName: string;
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discountAmount: string;
  subtotal: string;
}
