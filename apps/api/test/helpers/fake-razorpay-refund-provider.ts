import { CreateRefundInput, ProviderRefund, RefundProvider } from '../../src/modules/payments/providers/refund-provider.interface';

/**
 * A real Razorpay account was not available in this environment (mirrors
 * FakeRazorpayProvider's own doc comment for payments - see Phase 5 report
 * §22). This is a deterministic, in-memory MOCK - the Phase 10 report
 * explicitly distinguishes tests that ran against this from a REAL Razorpay
 * refund call, which never happened in this environment (§52).
 *
 * Failure-simulation flags mirror FakeRazorpayProvider's three distinct
 * distributed-failure shapes precisely:
 *   - failNextCreatePermanently: the provider genuinely never creates the
 *     refund (a real, clean failure - safe to record as FAILED).
 *   - simulateLostResponseOnce: the provider DOES create the refund (it's
 *     discoverable by receipt afterward) but the create() call itself still
 *     throws, simulating a lost HTTP response - must resolve to UNKNOWN,
 *     never blindly FAILED or blindly retried into a duplicate.
 *   - failNextFindByReceiptOnce: reconciliation itself is unreachable.
 */
export class FakeRazorpayRefundProvider implements RefundProvider {
  private readonly refunds = new Map<string, { paymentId: string; amount: number; status: 'pending' | 'processed' | 'failed'; receipt: string | null }>();
  private readonly refundsByReceipt = new Map<string, string>();
  private readonly runToken = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  private counter = 0;

  failNextCreatePermanently = false;
  simulateLostResponseOnce = false;
  failNextFindByReceiptOnce = false;
  /** When true, a created refund starts 'pending' rather than immediately 'processed' - lets a test drive the PROCESSING -> SUCCEEDED transition explicitly via resolveRefund(). */
  nextRefundStartsPending = false;
  createRefundCallCount = 0;

  async createRefund(input: CreateRefundInput): Promise<ProviderRefund> {
    this.createRefundCallCount += 1;

    if (this.failNextCreatePermanently) {
      this.failNextCreatePermanently = false;
      throw new Error('Simulated permanent provider failure - refund never created');
    }

    const id = `rfnd_test_${this.runToken}_${++this.counter}`;
    const status: 'pending' | 'processed' = this.nextRefundStartsPending ? 'pending' : 'processed';
    this.nextRefundStartsPending = false;
    this.refunds.set(id, { paymentId: input.providerPaymentId, amount: input.amountInMinorUnits, status, receipt: input.receipt });
    this.refundsByReceipt.set(`${input.providerPaymentId}:${input.receipt}`, id);

    if (this.simulateLostResponseOnce) {
      this.simulateLostResponseOnce = false;
      throw new Error('Simulated network failure - response lost after the provider actually created the refund');
    }

    return this.toProviderRefund(id);
  }

  async getRefund(refundId: string): Promise<ProviderRefund> {
    return this.toProviderRefund(refundId);
  }

  async findRefundByReceipt(providerPaymentId: string, receipt: string): Promise<ProviderRefund | null> {
    if (this.failNextFindByReceiptOnce) {
      this.failNextFindByReceiptOnce = false;
      throw new Error('Simulated network failure - reconciliation itself unreachable');
    }
    const refundId = this.refundsByReceipt.get(`${providerPaymentId}:${receipt}`);
    return refundId ? this.toProviderRefund(refundId) : null;
  }

  /** Test-only: simulates the provider's async processing finishing (pending -> processed/failed), as if a webhook or a later poll observed the outcome. */
  resolveRefund(refundId: string, status: 'processed' | 'failed'): void {
    const refund = this.refunds.get(refundId);
    if (!refund) throw new Error(`Unknown test refund id ${refundId}`);
    refund.status = status;
  }

  get distinctRemoteRefundCount(): number {
    return this.refunds.size;
  }

  private toProviderRefund(id: string): ProviderRefund {
    const refund = this.refunds.get(id);
    if (!refund) throw new Error(`Unknown test refund id ${id}`);
    return { id, paymentId: refund.paymentId, amount: refund.amount, status: refund.status, receipt: refund.receipt };
  }
}
