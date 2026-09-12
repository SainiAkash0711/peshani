import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

/**
 * Orchestration only - reuses CartModule/InventoryModule/OrdersModule/
 * PaymentsModule/PromotionsModule rather than duplicating any of their
 * logic (§4 "Do NOT duplicate these systems"). Phase 7 adds coupon
 * validation/reservation into the existing checkout transaction via
 * PromotionsModule's exported CouponRedemptionService/DiscountEngineService.
 */
@Module({
  imports: [CartModule, InventoryModule, OrdersModule, PaymentsModule, PromotionsModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}
