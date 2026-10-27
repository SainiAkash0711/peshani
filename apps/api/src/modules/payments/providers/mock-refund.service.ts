import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CreateRefundInput, ProviderRefund, RefundProvider } from './refund-provider.interface';

/**
 * Companion to MockPaymentService: refunds of dummy payments succeed at once
 * and move no money, so the returns/refund screens can be tried with mock
 * orders. Only selected when PAYMENT_MODE=mock.
 */
@Injectable()
export class MockRefundService implements RefundProvider {
  async createRefund(input: CreateRefundInput): Promise<ProviderRefund> {
    return {
      id: `rfnd_mock_${randomUUID()}`,
      paymentId: input.providerPaymentId,
      amount: input.amountInMinorUnits,
      status: 'processed',
      receipt: input.receipt,
    };
  }

  async getRefund(refundId: string, providerPaymentId?: string): Promise<ProviderRefund> {
    return { id: refundId, paymentId: providerPaymentId ?? '', amount: 0, status: 'processed', receipt: null };
  }

  async findRefundByReceipt(): Promise<ProviderRefund | null> {
    return null;
  }
}
