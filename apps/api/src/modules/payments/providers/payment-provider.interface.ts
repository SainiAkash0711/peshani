export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface CreateProviderOrderInput {
  amountInMinorUnits: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface ProviderOrder {
  id: string;
}

export interface ProviderPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
}

/**
 * The only boundary CheckoutService/PaymentService talk to for anything
 * provider-specific (Razorpay today). Swapping or adding a payment provider
 * later means implementing this interface, not rewriting checkout/payment
 * orchestration - see the Phase 5 report §69/§70.
 */
export interface PaymentProvider {
  readonly publicKeyId: string;
  createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder>;
  verifyPaymentSignature(params: { orderId: string; paymentId: string; signature: string }): boolean;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
  fetchPayment(paymentId: string): Promise<ProviderPayment>;
  /**
   * Correction pass (recovery): looks up a previously-created order by the
   * merchant `receipt` used to create it, without creating a new one.
   * PaymentService uses this to reconcile a `createOrder()` call whose HTTP
   * response was lost - the request may have already succeeded on the
   * provider's side, so recovery always checks here before ever concluding
   * failure or attempting to create a second remote order for the same
   * local Payment attempt. Returns null when no such order exists.
   */
  fetchOrderByReceipt(receipt: string): Promise<ProviderOrder | null>;
}
