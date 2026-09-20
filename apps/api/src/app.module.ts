import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { StoreSettingsModule } from './modules/store-settings/store-settings.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { BrandsModule } from './modules/brands/brands.module';
import { AttributesModule } from './modules/attributes/attributes.module';
import { ProductsModule } from './modules/products/products.module';
import { ProductVariantsModule } from './modules/product-variants/product-variants.module';
import { ProductImagesModule } from './modules/product-images/product-images.module';
import { HomepageSlidesModule } from './modules/homepage-slides/homepage-slides.module';
import { BlogPostsModule } from './modules/blog/blog-posts.module';
import { ContactModule } from './modules/contact/contact.module';
import { VariantImagesModule } from './modules/variant-images/variant-images.module';
import { WarehousesModule } from './modules/warehouses/warehouses.module';
import { ShippingMethodsModule } from './modules/shipping-methods/shipping-methods.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { StorefrontModule } from './modules/storefront/storefront.module';
import { CartModule } from './modules/cart/cart.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { HealthModule } from './modules/health/health.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { WishlistModule } from './modules/wishlist/wishlist.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { DiagnosticsModule } from './modules/diagnostics/diagnostics.module';
import { RazorpayClientModule } from './common/razorpay/razorpay-client.module';
import { MediaModule } from './common/media/media.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { throttleLimit } from './common/utils/throttle.util';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: throttleLimit(100) }] }),
    CommonModule,
    PrismaModule,
    RazorpayClientModule,
    AuditLogModule,
    StoreSettingsModule,
    AuthModule,
    UsersModule,
    RolesModule,
    CategoriesModule,
    BrandsModule,
    AttributesModule,
    MediaModule,
    ProductsModule,
    ProductVariantsModule,
    ProductImagesModule,
    HomepageSlidesModule,
    BlogPostsModule,
    ContactModule,
    VariantImagesModule,
    WarehousesModule,
    ShippingMethodsModule,
    PromotionsModule,
    InventoryModule,
    StorefrontModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    CheckoutModule,
    HealthModule,
    ReviewsModule,
    WishlistModule,
    NotificationsModule,
    ReturnsModule,
    AnalyticsModule,
    DiagnosticsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AppModule {}
