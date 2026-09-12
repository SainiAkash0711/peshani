import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StoreSettingsModule } from '../store-settings/store-settings.module';
import { MediaModule } from '../../common/media/media.module';
import { REFUND_PROVIDER } from '../payments/providers/refund-provider.interface';
import { RazorpayRefundService } from '../payments/providers/razorpay-refund.service';
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
    { provide: REFUND_PROVIDER, useClass: RazorpayRefundService },
  ],
  exports: [ReturnEligibilityService],
})
export class ReturnsModule {}
