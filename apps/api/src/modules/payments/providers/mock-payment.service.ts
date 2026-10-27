import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppConfig } from '../../../config/configuration';
import { CreateProviderOrderInput, PaymentProvider, ProviderOrder, ProviderPayment } from './payment-provider.interface';

const ORDER_PREFIX = 'order_mock_';
const PAYMENT_PREFIX = 'pay_mock_';

/**
 * A stand-in for Razorpay that moves no money. Selected only when
 * PAYMENT_MODE=mock, so a store can be tried end to end (cart -> checkout ->
 * "paid" order -> admin) before real gateway keys exist.
 *
 * It plugs in through the same PaymentProvider interface Razorpay uses, so
 * order creation, stock handling, coupons, emails and the payment-
 * verification checks in PaymentService all run unchanged. A payment is only
 * ever "captured" after the signed callback minted by issuePaymentCallback()
 * below is presented back - the browser cannot make one up, because the
 * signing key is derived from the server's JWT secret and never leaves it.
 *
 * Mock ids are recognisable on sight (order_mock_*, pay_mock_*), so a mock
 * payment can always be told apart from a real one in the admin/database.
 */
@Injectable()
export class MockPaymentService implements PaymentProvider {
  private readonly logger = new Logger(MockPaymentService.name);
  readonly publicKeyId = 'mock_gateway';
  private readonly signingKey: string;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService<AppConfig, true>,
  ) {
    this.signingKey = createHmac('sha256', configService.get('jwt', { infer: true }).accessSecret)
      .update('peshani-mock-payment-signing')
      .digest('hex');
    if (configService.get('paymentMode', { infer: true }) === 'mock') {
      this.logger.warn('PAYMENT_MODE=mock - the DUMMY payment gateway is active. Orders can be "paid" without any real money moving.');
    }
  }

  async createOrder(_input: CreateProviderOrderInput): Promise<ProviderOrder> {
    return { id: `${ORDER_PREFIX}${randomUUID()}` };
  }

  verifyPaymentSignature(params: { orderId: string; paymentId: string; signature: string }): boolean {
    return this.verifyHmac(`${params.orderId}|${params.paymentId}`, params.signature);
  }

  // There is no external system calling back in mock mode.
  verifyWebhookSignature(): boolean {
    return false;
  }

  async fetchPayment(paymentId: string): Promise<ProviderPayment> {
    if (!paymentId.startsWith(PAYMENT_PREFIX)) throw new NotFoundException('Unknown payment');
    const providerOrderId = `${ORDER_PREFIX}${paymentId.slice(PAYMENT_PREFIX.length)}`;
    const payment = await this.prisma.payment.findFirst({ where: { providerOrderId } });
    if (!payment) throw new NotFoundException('Unknown payment');
    return {
      id: paymentId,
      order_id: providerOrderId,
      amount: Math.round(Number(payment.amount) * 100),
      currency: payment.currency,
      status: 'captured',
    };
  }

  // createOrder() cannot lose its response here, so there is never anything to recover.
  async fetchOrderByReceipt(): Promise<ProviderOrder | null> {
    return null;
  }

  /**
   * What the fake payment window calls when the customer presses "Pay".
   * Only the authenticated owner of a still-open payment attempt gets a
   * signed callback; the browser then hands it to the normal verify endpoint.
   */
  async issuePaymentCallback(storeId: string, userId: string, orderNumber: string, providerOrderId: string) {
    if (!providerOrderId.startsWith(ORDER_PREFIX)) throw new BadRequestException('This payment was not created by the test gateway.');
    const order = await this.prisma.order.findFirst({ where: { storeId, userId, orderNumber } });
    if (!order) throw new NotFoundException('Order not found');
    const payment = await this.prisma.payment.findFirst({ where: { orderId: order.id, providerOrderId }, orderBy: { createdAt: 'desc' } });
    if (!payment) throw new BadRequestException('No matching payment attempt for this order.');

    const paymentId = `${PAYMENT_PREFIX}${providerOrderId.slice(ORDER_PREFIX.length)}`;
    return {
      razorpay_order_id: providerOrderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: createHmac('sha256', this.signingKey).update(`${providerOrderId}|${paymentId}`).digest('hex'),
    };
  }

  private verifyHmac(payload: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = Buffer.from(createHmac('sha256', this.signingKey).update(payload).digest('hex'), 'hex');
    const provided = Buffer.from(signature, 'hex');
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }
}
