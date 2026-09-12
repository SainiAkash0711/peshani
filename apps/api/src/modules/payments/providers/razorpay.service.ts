import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import Razorpay from 'razorpay';
import { AppConfig } from '../../../config/configuration';
import { CreateProviderOrderInput, PaymentProvider, ProviderOrder, ProviderPayment } from './payment-provider.interface';
import { RAZORPAY_CLIENT } from './razorpay-client.provider';

/**
 * The ONLY place Razorpay-specific code lives (master prompt §70/§18) -
 * CheckoutService and PaymentService never touch the `razorpay` package or
 * its HTTP client directly, only this class via the PaymentProvider
 * interface. RAZORPAY_KEY_SECRET/RAZORPAY_WEBHOOK_SECRET never leave this
 * class - nothing outside it ever reads them. The SDK client itself is
 * injected (RAZORPAY_CLIENT, see RazorpayClientModule) rather than
 * constructed here, so RazorpayRefundService (Phase 10) shares the exact
 * same client/credentials instead of duplicating construction (§23).
 */
@Injectable()
export class RazorpayService implements PaymentProvider {
  private readonly keySecret: string;
  private readonly webhookSecret: string;
  public readonly publicKeyId: string;

  constructor(
    @Inject(RAZORPAY_CLIENT) private readonly client: Razorpay,
    configService: ConfigService<AppConfig, true>,
  ) {
    const config = configService.get('razorpay', { infer: true });
    this.keySecret = config.keySecret;
    this.webhookSecret = config.webhookSecret;
    this.publicKeyId = config.keyId;
  }

  async createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder> {
    const order = await this.client.orders.create({
      amount: input.amountInMinorUnits,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
    });
    return { id: order.id };
  }

  /**
   * Razorpay's documented checkout-callback verification: HMAC-SHA256 of
   * `"<order_id>|<payment_id>"` using the account's key secret, compared to
   * the signature the browser callback returned. A valid signature alone is
   * NOT sufficient on its own - PaymentService additionally cross-checks the
   * order/amount/currency identity before trusting anything (see §24).
   */
  verifyPaymentSignature(params: { orderId: string; paymentId: string; signature: string }): boolean {
    return this.verifyHmac(`${params.orderId}|${params.paymentId}`, params.signature, this.keySecret);
  }

  /**
   * Verified against the RAW request body (never a re-serialized JSON
   * object - see §25) using the separate webhook secret configured in the
   * Razorpay dashboard, not the API key secret.
   */
  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    return this.verifyHmac(rawBody, signature, this.webhookSecret);
  }

  /** Recovery lookup (correction pass) - `orders.all({ receipt })` is Razorpay's own documented way to find an order by the merchant-supplied receipt, without creating a new one. */
  async fetchOrderByReceipt(receipt: string): Promise<ProviderOrder | null> {
    const result = await this.client.orders.all({ receipt });
    const match = result.items?.[0];
    return match ? { id: match.id } : null;
  }

  async fetchPayment(paymentId: string): Promise<ProviderPayment> {
    const payment = await this.client.payments.fetch(paymentId);
    return {
      id: payment.id,
      order_id: payment.order_id,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status,
    };
  }

  /** Constant-time comparison - a naive `===` on attacker-influenced input is a timing side-channel. */
  private verifyHmac(payload: string, signature: string | undefined, secret: string): boolean {
    if (!signature) return false;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const providedBuffer = Buffer.from(signature, 'hex');
    if (expectedBuffer.length !== providedBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, providedBuffer);
  }
}
