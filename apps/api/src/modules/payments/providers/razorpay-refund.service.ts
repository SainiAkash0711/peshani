import { Inject, Injectable } from '@nestjs/common';
import Razorpay from 'razorpay';
import { CreateRefundInput, ProviderRefund, RefundProvider } from './refund-provider.interface';
import { RAZORPAY_CLIENT } from './razorpay-client.provider';

/**
 * §23 - the only place Razorpay refund-specific code lives, injecting the
 * SAME authenticated `Razorpay` client instance RazorpayService itself uses
 * (RAZORPAY_CLIENT, see RazorpayClientModule) rather than duplicating
 * credentials/configuration (§23's explicit instruction). A real Razorpay
 * account was not available in this environment - see the Phase 10 report's
 * explicit REAL vs MOCK provider distinction (§52). This class's request
 * construction (payments.refund(paymentId, {amount, receipt, notes})) is
 * exactly what a real deployment would execute; it has not been exercised
 * against Razorpay's live API in this environment.
 */
@Injectable()
export class RazorpayRefundService implements RefundProvider {
  constructor(@Inject(RAZORPAY_CLIENT) private readonly client: Razorpay) {}

  async createRefund(input: CreateRefundInput): Promise<ProviderRefund> {
    const refund = await this.client.payments.refund(input.providerPaymentId, {
      amount: input.amountInMinorUnits,
      receipt: input.receipt,
      notes: input.notes,
    });
    return this.toProviderRefund(refund);
  }

  async getRefund(refundId: string, providerPaymentId?: string): Promise<ProviderRefund> {
    const refund = providerPaymentId ? await this.client.payments.fetchRefund(providerPaymentId, refundId) : await this.client.refunds.fetch(refundId);
    return this.toProviderRefund(refund);
  }

  /** Razorpay's documented "list refunds for a payment" endpoint - matched against OUR receipt to find a refund a lost-response create() call may have already produced. */
  async findRefundByReceipt(providerPaymentId: string, receipt: string): Promise<ProviderRefund | null> {
    const result = await this.client.payments.fetchMultipleRefund(providerPaymentId);
    const match = result.items?.find((r) => r.receipt === receipt);
    return match ? this.toProviderRefund(match) : null;
  }

  private toProviderRefund(refund: { id: string; payment_id: string; amount?: number; status: string; receipt?: string | null }): ProviderRefund {
    return {
      id: refund.id,
      paymentId: refund.payment_id,
      amount: Number(refund.amount ?? 0),
      status: refund.status === 'processed' || refund.status === 'failed' ? refund.status : 'pending',
      receipt: refund.receipt ?? null,
    };
  }
}
