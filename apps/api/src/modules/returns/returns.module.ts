import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StoreSettingsModule } from '../store-settings/store-settings.module';
import { MediaModule } from '../../common/media/media.module';
import { REFUND_PROVIDER } from '../payments/providers/refund-provider.interface';
import { RazorpayRefundService } from '../payments/providers/razorpay-refund.service';
import { MockRefundService } from '../payments/providers/mock-refund.service';
import { ReturnEligibilityService } from './return-eligibility.service';
import { RefundCalculationService } from './refund-calculation.service';
import { ReturnRequestService } from './return-request.service';
import { ReturnStatusService } from './return-status.service';
import { RefundService } from './refund.service';
import { ReturnEvidenceService } from './return-evidence.service';
import { AdminReturnsService } from './admin-returns.service';
import { ReturnsController } from './returns.controller';
import { AdminReturnsController } from './admin-returns.controller';

/**
 * §23 - RazorpayRefundService is bound to the REFUND_PROVIDER token, never
 * imported directly by RefundService, exactly mirroring how PAYMENT_PROVIDER
 * decouples PaymentService from RazorpayService. No separate credentials -
 * RazorpayRefundService reads the SAME `razorpay` config block PaymentService's
 * own RazorpayService already uses.
 */
@Module({
  imports: [InventoryModule, NotificationsModule, StoreSettingsModule, MediaModule],
  controllers: [ReturnsController, AdminReturnsController],
  providers: [
    ReturnEligibilityService,
    RefundCalculationService,
    ReturnRequestService,
    ReturnStatusService,
    RefundService,
    ReturnEvidenceService,
    AdminReturnsService,
    RazorpayRefundService,
    MockRefundService,
    {
      provide: REFUND_PROVIDER,
      useFactory: (config: ConfigService<AppConfig, true>, razorpay: RazorpayRefundService, mock: MockRefundService) =>
        config.get('paymentMode', { infer: true }) === 'mock' ? mock : razorpay,
      inject: [ConfigService, RazorpayRefundService, MockRefundService],
    },
  ],
  exports: [ReturnEligibilityService],
})
export class ReturnsModule {}
