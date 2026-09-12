import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { RazorpayService } from './providers/razorpay.service';
import { PAYMENT_PROVIDER } from './providers/payment-provider.interface';

/**
 * Checkout + Payments + Orders is the full financial scope of Phase 5 - no
 * refunds/loyalty/subscription code lives here (see the Phase 5 report's
 * scope boundary). RazorpayService is bound to the PAYMENT_PROVIDER token
 * (never imported directly by PaymentService or CheckoutService) so a
 * future provider only ever needs a new PaymentProvider implementation,
 * never a rewrite of the orchestration code - see
 * payment-provider.interface.ts. PromotionsModule is imported so
 * PaymentService can consume/release a coupon redemption at the exact same
 * lifecycle points it already confirms/cancels an Order (Phase 7).
 */
@Module({
  imports: [OrdersModule, InventoryModule, PromotionsModule, NotificationsModule],
  controllers: [PaymentController],
  providers: [PaymentService, { provide: PAYMENT_PROVIDER, useClass: RazorpayService }],
  exports: [PaymentService],
})
export class PaymentsModule {}
