import { Module } from '@nestjs/common';
import { StoreSettingsModule } from '../store-settings/store-settings.module';
import { StorefrontModule } from '../storefront/storefront.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

/**
 * Cart foundation only (Phase 4) - no Checkout/Payments/Orders/Shipping/
 * Coupons/Wishlist/Reviews code lives here or anywhere else in this module.
 * Cart quantity is never a StockReservation (see CartService's class-level
 * doc comment) - reservation is a future checkout-phase concern.
 */
@Module({
  imports: [StoreSettingsModule, StorefrontModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
