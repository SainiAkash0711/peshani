import { Module } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { CouponsService } from './coupons.service';
import { DiscountEngineService } from './discount-engine.service';
import { CouponRedemptionService } from './coupon-redemption.service';
import { PromotionsController } from './promotions.controller';
import { CouponsController } from './coupons.controller';

/**
 * Phase 7 - a leaf module (imports nothing from Orders/Payments/Checkout)
 * so it can safely be imported BY all three without creating a cycle.
 * DiscountEngineService/CouponRedemptionService are exported for
 * CheckoutService (reserve + preview), PaymentService (consume/release),
 * and OrderStatusService (release on PENDING_PAYMENT cancellation).
 */
@Module({
  controllers: [PromotionsController, CouponsController],
  providers: [PromotionsService, CouponsService, DiscountEngineService, CouponRedemptionService],
  exports: [PromotionsService, CouponsService, DiscountEngineService, CouponRedemptionService],
})
export class PromotionsModule {}
