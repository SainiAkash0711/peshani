export const REFUND_PROVIDER = Symbol('REFUND_PROVIDER');

export interface CreateRefundInput {
  /** The PROVIDER's own payment id (Payment.providerPaymentId), never our local Payment row id. */
  providerPaymentId: string;
  amountInMinorUnits: number;
  /** Our own deterministic identifier (the local Refund row's id) - echoed back by the provider on fetch/list, used for recovery lookups exactly like PaymentProvider.fetchOrderByReceipt. */
  receipt: string;
  notes?: Record<string, string>;
}

export interface ProviderRefund {
  id: string;
  paymentId: string;
  amount: number;
  status: 'pending' | 'processed' | 'failed';
  receipt: string | null;
}

/**
 * §23/§4 - the only boundary RefundService talks to for anything provider-
 * specific. Real money moves through this interface; RefundService never
 * assumes success merely because a local DB write succeeded (§4) - it only
 * ever trusts what this interface actually returns, or what a subsequent
 * findRefundByReceipt() reconciliation confirms.
 */
export interface RefundProvider {
  createRefund(input: CreateRefundInput): Promise<ProviderRefund>;
  getRefund(refundId: string, providerPaymentId?: string): Promise<ProviderRefund>;
  /**
   * §24/§26 - recovery lookup. Used when createRefund() itself throws
   * (network timeout, lost response) to determine whether the provider
   * actually created the refund before concluding FAILED vs UNKNOWN - the
   * exact same shape as PaymentProvider.fetchOrderByReceipt's own recovery
   * role for payment orders. Returns null if no such refund is found.
   */
  findRefundByReceipt(providerPaymentId: string, receipt: string): Promise<ProviderRefund | null>;
}
