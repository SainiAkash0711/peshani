import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Razorpay from 'razorpay';
import { AppConfig } from '../../config/configuration';
import { RAZORPAY_CLIENT } from '../../modules/payments/providers/razorpay-client.provider';

/**
 * §23 - the ONE place the Razorpay SDK client is ever constructed, reading
 * key id/secret from configuration exactly once. Both RazorpayService
 * (payments) and RazorpayRefundService (Phase 10 refunds) inject this same
 * client instance via the RAZORPAY_CLIENT token rather than each
 * constructing their own - "do not duplicate credentials/configuration"
 * applies to the client construction itself, not only the raw secret
 * values. @Global() so ReturnsModule (which does not import PaymentsModule,
 * to avoid a module cycle) can use it without a direct dependency between
 * the two feature modules.
 */
@Global()
@Module({
  providers: [
    {
      provide: RAZORPAY_CLIENT,
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const config = configService.get('razorpay', { infer: true });
        return new Razorpay({ key_id: config.keyId, key_secret: config.keySecret });
      },
      inject: [ConfigService],
    },
  ],
  exports: [RAZORPAY_CLIENT],
})
export class RazorpayClientModule {}
