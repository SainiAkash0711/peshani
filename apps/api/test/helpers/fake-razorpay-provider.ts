import { createHmac } from 'node:crypto';
import {
  CreateProviderOrderInput,
  PaymentProvider,
  ProviderOrder,
  ProviderPayment,
} from '../../src/modules/payments/providers/payment-provider.interface';

export const FAKE_KEY_SECRET = 'test-key-secret';
export const FAKE_WEBHOOK_SECRET = 'test-webhook-secret';

/**
 * A real Razorpay account/credentials were not available in this
 * environment (see the Phase 5 final report §22). This stands in ONLY for
 * the operations that need real network access to Razorpay's API
 * (creating/fetching a remote order, reconciling one by receipt) - every
 * signature-verification method runs the EXACT same HMAC algorithm
 * PaymentService/RazorpayService use in production, against a real
 * (test-only) shared secret, so verification itself is tested for real,
 * never bypassed or stubbed to always return true.
 *
 * The three failure-simulation flags below (correction pass) let tests
 * distinguish the three distributed-failure shapes precisely:
 *   - failNextCreateOrderPermanently: the provider genuinely never creates
 *     the order (Case A - safe to cancel).
 *   - simulateLostResponseOnce: the provider DOES create the order (it's
 *     discoverable by receipt afterward) but the create() call itself still
 *     throws, simulating a lost HTTP response (Case C - must recover, not duplicate).
 *   - failNextFetchByReceiptOnce: reconciliation itself is unreachable, so
 *     even the "is it uncertain or genuinely failed" check can't run.
 */
export class FakeRazorpayProvider implements PaymentProvider {
  public readonly publicKeyId = 'rzp_test_fake_key_id';
  private readonly orders = new Map<string, { amount: number; currency: string; receipt: string }>();
  private readonly ordersByReceipt = new Map<string, string>();
  private readonly payments = new Map<string, ProviderPayment>();
  // Payment.providerOrderId is uniquely constrained in the real database,
  // and this suite runs against the same persistent dev Postgres every
  // time (see the project's established runId-suffixing convention) - a
  // plain per-run counter starting at 1 would collide with a previous run's
  // already-committed "order_test_1" the moment a Payment row for it exists.
  private readonly runToken = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  private counter = 0;

  failNextCreateOrderPermanently = false;
  simulateLostResponseOnce = false;
  failNextFetchByReceiptOnce = false;
  createOrderCallCount = 0;
  /** Final micro-correction: lets a concurrency test force a real waiting window on the ONE request that wins the create-order claim, so a concurrent "loser" request genuinely exercises its poll-and-reuse path rather than finding the result already there instantly. */
  nextCreateOrderDelayMs = 0;

  async createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder> {
    this.createOrderCallCount += 1;

    if (this.nextCreateOrderDelayMs > 0) {
      const delay = this.nextCreateOrderDelayMs;
      this.nextCreateOrderDelayMs = 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (this.failNextCreateOrderPermanently) {
      this.failNextCreateOrderPermanently = false;
      throw new Error('Simulated permanent provider failure - order never created');
    }

    const id = `order_test_${this.runToken}_${++this.counter}`;
    this.orders.set(id, { amount: input.amountInMinorUnits, currency: input.currency, receipt: input.receipt });
    this.ordersByReceipt.set(input.receipt, id);

    if (this.simulateLostResponseOnce) {
      this.simulateLostResponseOnce = false;
      // The order above IS stored (Razorpay's side succeeded) - only the
      // response back to us is "lost".
      throw new Error('Simulated network failure - response lost after the provider actually created the order');
    }

    return { id };
  }

  async fetchOrderByReceipt(receipt: string): Promise<ProviderOrder | null> {
    if (this.failNextFetchByReceiptOnce) {
      this.failNextFetchByReceiptOnce = false;
      throw new Error('Simulated network failure - reconciliation itself unreachable');
    }
    const orderId = this.ordersByReceipt.get(receipt);
    return orderId ? { id: orderId } : null;
  }

  verifyPaymentSignature(params: { orderId: string; paymentId: string; signature: string }): boolean {
    const expected = createHmac('sha256', FAKE_KEY_SECRET).update(`${params.orderId}|${params.paymentId}`).digest('hex');
    return expected === params.signature;
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const expected = createHmac('sha256', FAKE_WEBHOOK_SECRET).update(rawBody).digest('hex');
    return expected === signature;
  }

  async fetchPayment(paymentId: string): Promise<ProviderPayment> {
    const payment = this.payments.get(paymentId);
    if (!payment) throw new Error(`Unknown test payment id ${paymentId}`);
    return payment;
  }

  /** Test-only: simulates the customer completing (or failing) payment in Razorpay's checkout widget. */
  registerPayment(paymentId: string, razorpayOrderId: string, status: 'captured' | 'failed' = 'captured'): void {
    const order = this.orders.get(razorpayOrderId);
    if (!order) throw new Error(`Unknown test order id ${razorpayOrderId}`);
    this.payments.set(paymentId, { id: paymentId, order_id: razorpayOrderId, amount: order.amount, currency: order.currency, status });
  }

  getOrderAmount(razorpayOrderId: string): number | undefined {
    return this.orders.get(razorpayOrderId)?.amount;
  }

  /** How many distinct remote orders actually got created (regardless of how many local Payment rows/attempts reference them) - used to prove recovery never creates a duplicate remote order. */
  get distinctRemoteOrderCount(): number {
    return this.orders.size;
  }
}

export function signPayment(orderId: string, paymentId: string): string {
  return createHmac('sha256', FAKE_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
}

export function signWebhookBody(rawBody: string): string {
  return createHmac('sha256', FAKE_WEBHOOK_SECRET).update(rawBody).digest('hex');
}
