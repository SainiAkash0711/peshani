import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppConfig } from '../src/config/configuration';
import { DEFAULT_STORE_SLUG } from '../src/modules/store-settings/store-settings.service';
import { PAYMENT_PROVIDER } from '../src/modules/payments/providers/payment-provider.interface';
import { FakeRazorpayProvider, signPayment, signWebhookBody } from './helpers/fake-razorpay-provider';

describe('Peshani Checkout + Payments + Orders (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService<AppConfig, true>;
  let fakeProvider: FakeRazorpayProvider;
  let storeId: string;

  const runId = Date.now();
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => `Bearer ${token}`;

  let warehouseId: string;

  const address = {
    fullName: 'Test Customer',
    phone: '9876543210',
    addressLine1: '221B Baker Street',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400001',
    country: 'India',
  };

  async function createProduct(name: string, price: string, available: number) {
    const product = await prisma.product.create({
      data: { storeId, name, slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${runId}`, sku: `${name.replace(/\s+/g, '')}-${runId}`, status: 'ACTIVE', productType: 'SIMPLE', basePrice: price },
    });
    await prisma.inventoryItem.create({
      data: { storeId, productId: product.id, variantId: null, warehouseId, onHandQuantity: available, availableQuantity: available, reservedQuantity: 0 },
    });
    return product.id;
  }

  async function createCustomer(email: string, password: string) {
    // AuthService always lowercases the email for both storage (register)
    // and lookup (login) - this helper bypasses register() and writes the
    // user directly, so it must normalize the same way or a mixed-case
    // local part (e.g. "ownerA") stored as-is would never match login's
    // lowercased lookup.
    const normalizedEmail = email.toLowerCase();
    const passwordHash = await argon2.hash(password);
    const role = await prisma.role.findUnique({ where: { storeId_name: { storeId, name: 'CUSTOMER' } } });
    const user = await prisma.user.create({ data: { storeId, email: normalizedEmail, passwordHash, type: 'CUSTOMER', isActive: true, emailVerifiedAt: new Date() } });
    if (role) await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const login = await api().post('/api/v1/auth/login').send({ email: normalizedEmail, password });
    return login.body.accessToken as string;
  }

  async function addToCart(token: string, productId: string, quantity: number) {
    await api().post('/api/v1/cart/items').set('Authorization', auth(token)).send({ productId, quantity });
  }

  async function createCheckout(token: string, idempotencyKey?: string) {
    const req = api().post('/api/v1/checkout/create').set('Authorization', auth(token)).send({ email: 'buyer@example.com', billingAddress: address });
    if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
    return req;
  }

  beforeAll(async () => {
    fakeProvider = new FakeRazorpayProvider();

    // This suite alone makes far more requests than any real customer would
    // in a minute (dozens of scenarios, each its own login/cart/checkout/
    // verify sequence) - THROTTLE_TEST_MODE (set in .env, see
    // throttle.util.ts) raises every rate limit high enough to accommodate
    // that, without touching the real production limits each route falls
    // back to. Guards registered via APP_GUARD (like ThrottlerGuard here)
    // cannot be swapped with TestingModuleBuilder.overrideGuard() - that only
    // finds guards provided under their own class token, not the APP_GUARD
    // multi-provider token - hence this env-based approach instead.
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(fakeProvider)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService<AppConfig, true>);

    const store = await prisma.store.findUniqueOrThrow({ where: { slug: DEFAULT_STORE_SLUG } });
    storeId = store.id;

    const warehouse = await prisma.warehouse.create({ data: { storeId, name: `Checkout WH ${runId}`, code: `CHK-WH-${runId}`, isActive: true, isDefault: true } });
    warehouseId = warehouse.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Checkout validation', () => {
    it('reports not-ready for an empty cart', async () => {
      const token = await createCustomer(`checkout.empty.${runId}@example.com`, 'Secret123!');
      const res = await api().post('/api/v1/checkout/validate').set('Authorization', auth(token));
      expect(res.status).toBe(201);
      expect(res.body.readyForCheckout).toBe(false);
    });

    it('reports ready once a valid item is in the cart', async () => {
      const token = await createCustomer(`checkout.ready.${runId}@example.com`, 'Secret123!');
      const productId = await createProduct(`Checkout Ready ${runId}`, '299.00', 10);
      await addToCart(token, productId, 1);
      const res = await api().post('/api/v1/checkout/validate').set('Authorization', auth(token));
      expect(res.body.readyForCheckout).toBe(true);
    });

    it('rejects checkout for an unauthenticated request', async () => {
      const res = await api().post('/api/v1/checkout/create').send({ email: 'x@example.com', billingAddress: address });
      expect(res.status).toBe(401);
    });
  });

  describe('Checkout create', () => {
    it('creates an Order, a Payment attempt, and an inventory reservation, and empties the cart', async () => {
      const token = await createCustomer(`checkout.create.${runId}@example.com`, 'Secret123!');
      const productId = await createProduct(`Checkout Create ${runId}`, '500.00', 10);
      await addToCart(token, productId, 2);

      const res = await createCheckout(token);
      expect(res.status).toBe(201);
      expect(res.body.orderNumber).toMatch(/^PES-\d{8}-[A-F0-9]{8}$/);
      expect(res.body.amount).toBe('1000.00');
      expect(res.body.razorpayKeyId).toBe(fakeProvider.publicKeyId);
      expect(res.body).not.toHaveProperty('razorpayKeySecret');

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.orderNumber }, include: { items: true, payments: true } });
      expect(order.status).toBe('PENDING_PAYMENT');
      expect(order.totalAmount.toFixed(2)).toBe('1000.00');
      expect(order.items).toHaveLength(1);
      expect(order.items[0].productNameSnapshot).toContain('Checkout Create');
      expect(order.payments).toHaveLength(1);
      // Final micro-correction (§13): CREATED -> PENDING is the atomic claim
      // a request takes before calling Razorpay's createOrder(), so a
      // successful attempt never calls back to CREATED - PENDING is the
      // correct resting status once a provider order exists, still counted
      // as "still open" (ACTIVE_PAYMENT_STATUSES) for verify/retry.
      expect(order.payments[0].status).toBe('PENDING');
      expect(order.payments[0].providerOrderId).toBe(res.body.razorpayOrderId);

      const reservations = await prisma.stockReservation.findMany({ where: { orderId: order.id } });
      expect(reservations).toHaveLength(1);
      expect(reservations[0].status).toBe('ACTIVE');
      expect(reservations[0].quantity).toBe(2);

      const cart = await api().get('/api/v1/cart').set('Authorization', auth(token));
      expect(cart.body.items).toEqual([]);
    });

    it('rejects checkout with an empty cart', async () => {
      const token = await createCustomer(`checkout.emptycreate.${runId}@example.com`, 'Secret123!');
      const res = await createCheckout(token);
      expect(res.status).toBe(400);
    });

    it('rejects checkout for an inactive product still sitting in the cart', async () => {
      const token = await createCustomer(`checkout.inactive.${runId}@example.com`, 'Secret123!');
      const productId = await createProduct(`Checkout Inactive ${runId}`, '150.00', 10);
      await addToCart(token, productId, 1);
      await prisma.product.update({ where: { id: productId }, data: { status: 'INACTIVE' } });

      const res = await createCheckout(token);
      expect(res.status).toBe(409);
      // No order (and so no dangling reservation) for THIS specific product
      // was created - the whole Phase A transaction rolled back.
      const orderForThisProduct = await prisma.order.findFirst({ where: { storeId, items: { some: { productId } } } });
      expect(orderForThisProduct).toBeNull();
    });

    it('rejects checkout when requested quantity exceeds available stock', async () => {
      const token = await createCustomer(`checkout.insufficient.${runId}@example.com`, 'Secret123!');
      const productId = await createProduct(`Checkout Insufficient ${runId}`, '150.00', 1);
      await addToCart(token, productId, 1);
      // Drain the stock after adding to cart (cart doesn't reserve - Phase 4).
      // Both columns move together - a real stock depletion, not a
      // fabricated available-only edit that would itself violate the
      // onHand/reserved/available invariant inventory.e2e-spec.ts checks
      // directly against Postgres.
      await prisma.inventoryItem.updateMany({ where: { productId }, data: { onHandQuantity: 0, availableQuantity: 0 } });

      const res = await createCheckout(token);
      expect(res.status).toBe(409);
    });

    it('never trusts a client-supplied amount/price/currency/userId/storeId - the DTO does not even accept them', async () => {
      const token = await createCustomer(`checkout.tamper.${runId}@example.com`, 'Secret123!');
      const productId = await createProduct(`Checkout Tamper ${runId}`, '500.00', 10);
      await addToCart(token, productId, 1);

      const res = await api()
        .post('/api/v1/checkout/create')
        .set('Authorization', auth(token))
        .send({ email: 'buyer@example.com', billingAddress: address, amount: 1, totalAmount: '1.00', currency: 'USD', userId: 'x', storeId: 'y' });
      expect(res.status).toBe(400); // forbidNonWhitelisted rejects the unknown fields outright
    });

    describe('Idempotency-Key', () => {
      it('returns the same order for a retried request with the same key and payload', async () => {
        const token = await createCustomer(`checkout.idem1.${runId}@example.com`, 'Secret123!');
        const productId = await createProduct(`Checkout Idem1 ${runId}`, '200.00', 10);
        await addToCart(token, productId, 1);

        const key = `idem-key-${runId}-1`;
        const first = await createCheckout(token, key);
        const second = await createCheckout(token, key);
        expect(second.body.orderNumber).toBe(first.body.orderNumber);

        const orderCount = await prisma.order.count({ where: { storeId, idempotencyKey: key } });
        expect(orderCount).toBe(1);
      });

      it('rejects a key reused with a different payload', async () => {
        const token = await createCustomer(`checkout.idem2.${runId}@example.com`, 'Secret123!');
        const productId = await createProduct(`Checkout Idem2 ${runId}`, '200.00', 10);
        await addToCart(token, productId, 1);

        const key = `idem-key-${runId}-2`;
        await createCheckout(token, key);

        await addToCart(token, productId, 1); // cart is non-empty again for the second, DIFFERENT-payload attempt
        const res = await api()
          .post('/api/v1/checkout/create')
          .set('Authorization', auth(token))
          .set('Idempotency-Key', key)
          .send({ email: 'someone-else@example.com', billingAddress: address });
        expect(res.status).toBe(409);
      });
    });
  });

  describe('Payment verification', () => {
    async function checkoutAndPay(token: string, quantity = 1) {
      const productId = await createProduct(`Verify Flow ${runId}-${Math.random()}`, '400.00', 10);
      await addToCart(token, productId, quantity);
      const checkout = await createCheckout(token);
      return { checkout: checkout.body, productId };
    }

    it('confirms the order on a valid signature and captured payment', async () => {
      const token = await createCustomer(`verify.success.${runId}@example.com`, 'Secret123!');
      const { checkout } = await checkoutAndPay(token);

      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(paymentId, checkout.razorpayOrderId, 'captured');
      const signature = signPayment(checkout.razorpayOrderId, paymentId);

      const res = await api()
        .post('/api/v1/payments/razorpay/verify')
        .set('Authorization', auth(token))
        .send({ orderNumber: checkout.orderNumber, razorpayOrderId: checkout.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: signature });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('CONFIRMED');
      expect(res.body.paymentStatus).toBe('CAPTURED');

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.orderNumber } });
      expect(order.status).toBe('CONFIRMED');
      const reservations = await prisma.stockReservation.findMany({ where: { orderId: order.id } });
      expect(reservations.every((r) => r.status === 'COMMITTED')).toBe(true);
    });

    it('rejects an invalid signature and marks the payment FAILED, leaving the order retryable', async () => {
      const token = await createCustomer(`verify.badsig.${runId}@example.com`, 'Secret123!');
      const { checkout } = await checkoutAndPay(token);

      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(paymentId, checkout.razorpayOrderId, 'captured');

      const res = await api()
        .post('/api/v1/payments/razorpay/verify')
        .set('Authorization', auth(token))
        .send({ orderNumber: checkout.orderNumber, razorpayOrderId: checkout.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: 'deadbeef'.repeat(8) });
      expect(res.status).toBe(400);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.orderNumber }, include: { payments: true } });
      expect(order.status).toBe('PENDING_PAYMENT');
      expect(order.payments[0].status).toBe('FAILED');
    });

    it('rejects a signature computed for a DIFFERENT payment id (tampered payload)', async () => {
      const token = await createCustomer(`verify.tamperedid.${runId}@example.com`, 'Secret123!');
      const { checkout } = await checkoutAndPay(token);

      const realPaymentId = `pay_test_real_${Math.random().toString(36).slice(2)}`;
      const claimedPaymentId = `pay_test_claimed_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(realPaymentId, checkout.razorpayOrderId, 'captured');
      const signature = signPayment(checkout.razorpayOrderId, realPaymentId); // signed for the REAL id

      const res = await api()
        .post('/api/v1/payments/razorpay/verify')
        .set('Authorization', auth(token))
        .send({ orderNumber: checkout.orderNumber, razorpayOrderId: checkout.razorpayOrderId, razorpayPaymentId: claimedPaymentId, razorpaySignature: signature });
      expect(res.status).toBe(400);
    });

    it('rejects a razorpayOrderId that belongs to a DIFFERENT order', async () => {
      const tokenA = await createCustomer(`verify.crossorderA.${runId}@example.com`, 'Secret123!');
      const tokenB = await createCustomer(`verify.crossorderB.${runId}@example.com`, 'Secret123!');
      const { checkout: checkoutA } = await checkoutAndPay(tokenA);
      const { checkout: checkoutB } = await checkoutAndPay(tokenB);

      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(paymentId, checkoutB.razorpayOrderId, 'captured');
      const signature = signPayment(checkoutB.razorpayOrderId, paymentId);

      // Customer A tries to verify using order B's razorpayOrderId against order A's orderNumber.
      const res = await api()
        .post('/api/v1/payments/razorpay/verify')
        .set('Authorization', auth(tokenA))
        .send({ orderNumber: checkoutA.orderNumber, razorpayOrderId: checkoutB.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: signature });
      expect(res.status).toBe(404);
    });

    it('is idempotent on a repeated verify call for an already-captured payment (no double-consume)', async () => {
      const token = await createCustomer(`verify.repeat.${runId}@example.com`, 'Secret123!');
      const { checkout } = await checkoutAndPay(token);
      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(paymentId, checkout.razorpayOrderId, 'captured');
      const signature = signPayment(checkout.razorpayOrderId, paymentId);
      const body = { orderNumber: checkout.orderNumber, razorpayOrderId: checkout.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: signature };

      const first = await api().post('/api/v1/payments/razorpay/verify').set('Authorization', auth(token)).send(body);
      const second = await api().post('/api/v1/payments/razorpay/verify').set('Authorization', auth(token)).send(body);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.status).toBe('CONFIRMED');

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.orderNumber } });
      const item = await prisma.inventoryItem.findFirstOrThrow({ where: { productId: (await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).productId! } });
      // committedQuantity reflects exactly one commit, not two.
      expect(item.committedQuantity).toBe(1);
    });

    it('rejects a payment the provider itself did not mark captured', async () => {
      const token = await createCustomer(`verify.notcaptured.${runId}@example.com`, 'Secret123!');
      const { checkout } = await checkoutAndPay(token);
      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(paymentId, checkout.razorpayOrderId, 'failed');
      const signature = signPayment(checkout.razorpayOrderId, paymentId);

      const res = await api()
        .post('/api/v1/payments/razorpay/verify')
        .set('Authorization', auth(token))
        .send({ orderNumber: checkout.orderNumber, razorpayOrderId: checkout.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: signature });
      expect(res.status).toBe(400);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.orderNumber } });
      expect(order.status).toBe('PENDING_PAYMENT');
    });

    it("rejects verifying another customer's order", async () => {
      const owner = await createCustomer(`verify.ownerA.${runId}@example.com`, 'Secret123!');
      const intruder = await createCustomer(`verify.intruderB.${runId}@example.com`, 'Secret123!');
      const { checkout } = await checkoutAndPay(owner);
      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(paymentId, checkout.razorpayOrderId, 'captured');
      const signature = signPayment(checkout.razorpayOrderId, paymentId);

      const res = await api()
        .post('/api/v1/payments/razorpay/verify')
        .set('Authorization', auth(intruder))
        .send({ orderNumber: checkout.orderNumber, razorpayOrderId: checkout.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: signature });
      expect(res.status).toBe(404);
    });
  });

  describe('Webhook', () => {
    async function checkoutOnly(token: string) {
      const productId = await createProduct(`Webhook Flow ${runId}-${Math.random()}`, '250.00', 10);
      await addToCart(token, productId, 1);
      const checkout = await createCheckout(token);
      return checkout.body;
    }

    function webhookPayload(event: string, razorpayOrderId: string, paymentId: string, amount: number, currency: string, eventId: string) {
      return JSON.stringify({
        id: eventId,
        event,
        payload: { payment: { entity: { id: paymentId, order_id: razorpayOrderId, amount, currency, status: event === 'payment.captured' ? 'captured' : 'failed' } } },
      });
    }

    it('confirms the order via a validly-signed payment.captured webhook alone (no client verify call)', async () => {
      const token = await createCustomer(`webhook.success.${runId}@example.com`, 'Secret123!');
      const checkout = await checkoutOnly(token);
      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      const amount = Math.round(Number(checkout.amount) * 100);
      const body = webhookPayload('payment.captured', checkout.razorpayOrderId, paymentId, amount, checkout.currency, `evt_${runId}_1`);
      const signature = signWebhookBody(body);

      const res = await api().post('/api/v1/payments/razorpay/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', signature).send(body);
      expect(res.status).toBe(200);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.orderNumber } });
      expect(order.status).toBe('CONFIRMED');
    });

    it('rejects a webhook with an invalid signature', async () => {
      const token = await createCustomer(`webhook.badsig.${runId}@example.com`, 'Secret123!');
      const checkout = await checkoutOnly(token);
      const body = webhookPayload('payment.captured', checkout.razorpayOrderId, 'pay_x', 25000, checkout.currency, `evt_${runId}_2`);

      const res = await api().post('/api/v1/payments/razorpay/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', 'not-a-real-signature').send(body);
      expect(res.status).toBe(400);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.orderNumber } });
      expect(order.status).toBe('PENDING_PAYMENT');
    });

    it('processes a duplicate webhook delivery exactly once', async () => {
      const token = await createCustomer(`webhook.duplicate.${runId}@example.com`, 'Secret123!');
      const checkout = await checkoutOnly(token);
      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      const amount = Math.round(Number(checkout.amount) * 100);
      const eventId = `evt_${runId}_dup`;
      const body = webhookPayload('payment.captured', checkout.razorpayOrderId, paymentId, amount, checkout.currency, eventId);
      const signature = signWebhookBody(body);

      const first = await api().post('/api/v1/payments/razorpay/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', signature).send(body);
      const second = await api().post('/api/v1/payments/razorpay/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', signature).send(body);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const eventCount = await prisma.paymentWebhookEvent.count({ where: { eventId } });
      expect(eventCount).toBe(1);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.orderNumber } });
      const reservations = await prisma.stockReservation.findMany({ where: { orderId: order.id } });
      const item = await prisma.inventoryItem.findFirstOrThrow({ where: { id: (await prisma.stockReservation.findFirstOrThrow({ where: { orderId: order.id } })).inventoryItemId } });
      expect(reservations.every((r) => r.status === 'COMMITTED')).toBe(true);
      expect(item.committedQuantity).toBe(1); // not 2, despite two identical deliveries
    });

    it('acknowledges an unrecognized event type without changing any state', async () => {
      const token = await createCustomer(`webhook.unknown.${runId}@example.com`, 'Secret123!');
      const checkout = await checkoutOnly(token);
      const body = JSON.stringify({ id: `evt_${runId}_unknown`, event: 'refund.processed', payload: {} });
      const signature = signWebhookBody(body);

      const res = await api().post('/api/v1/payments/razorpay/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', signature).send(body);
      expect(res.status).toBe(200);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.orderNumber } });
      expect(order.status).toBe('PENDING_PAYMENT');
    });

    it('marks the payment FAILED on a payment.failed webhook', async () => {
      const token = await createCustomer(`webhook.failed.${runId}@example.com`, 'Secret123!');
      const checkout = await checkoutOnly(token);
      const body = webhookPayload('payment.failed', checkout.razorpayOrderId, 'pay_failed_x', 25000, checkout.currency, `evt_${runId}_failed`);
      const signature = signWebhookBody(body);

      const res = await api().post('/api/v1/payments/razorpay/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', signature).send(body);
      expect(res.status).toBe(200);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.orderNumber }, include: { payments: true } });
      expect(order.payments[0].status).toBe('FAILED');
      expect(order.status).toBe('PENDING_PAYMENT'); // still retryable
    });
  });

  describe('Payment retry', () => {
    it('retrying a still-open (never-failed) attempt recovers/reuses it rather than creating a redundant duplicate', async () => {
      // Corrected behavior (Phase 5 correction pass, superseding this test's
      // original pre-correction expectation): retry-payment is now
      // recovery-aware - see payment-recovery.e2e-spec.ts's R6. A payment
      // attempt that hasn't failed yet (still CREATED/PENDING/AUTHORIZED) is
      // reused, never silently duplicated into a second live Razorpay order
      // for the exact same checkout intent.
      const token = await createCustomer(`retry.same.${runId}@example.com`, 'Secret123!');
      const productId = await createProduct(`Retry Same ${runId}`, '350.00', 10);
      await addToCart(token, productId, 1);
      const checkout = await createCheckout(token);

      const retry = await api().post(`/api/v1/checkout/orders/${checkout.body.orderNumber}/retry-payment`).set('Authorization', auth(token));
      expect(retry.status).toBe(201);
      expect(retry.body.orderNumber).toBe(checkout.body.orderNumber);
      expect(retry.body.razorpayOrderId).toBe(checkout.body.razorpayOrderId);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.body.orderNumber }, include: { payments: true } });
      expect(order.payments).toHaveLength(1);
    });

    it('retrying AFTER the attempt has genuinely FAILED creates a new payment attempt against the SAME order, never a new order', async () => {
      const token = await createCustomer(`retry.afterfail.${runId}@example.com`, 'Secret123!');
      const productId = await createProduct(`Retry AfterFail ${runId}`, '350.00', 10);
      await addToCart(token, productId, 1);
      const checkout = await createCheckout(token);

      const badVerify = await api()
        .post('/api/v1/payments/razorpay/verify')
        .set('Authorization', auth(token))
        .send({ orderNumber: checkout.body.orderNumber, razorpayOrderId: checkout.body.razorpayOrderId, razorpayPaymentId: 'pay_bad', razorpaySignature: 'f'.repeat(64) });
      expect(badVerify.status).toBe(400);

      const retry = await api().post(`/api/v1/checkout/orders/${checkout.body.orderNumber}/retry-payment`).set('Authorization', auth(token));
      expect(retry.status).toBe(201);
      expect(retry.body.orderNumber).toBe(checkout.body.orderNumber);
      expect(retry.body.razorpayOrderId).not.toBe(checkout.body.razorpayOrderId);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.body.orderNumber }, include: { payments: true } });
      expect(order.payments).toHaveLength(2);
    });

    it('re-reserves stock when the original reservation was released before retry', async () => {
      const token = await createCustomer(`retry.reReserve.${runId}@example.com`, 'Secret123!');
      const productId = await createProduct(`Retry Rereserve ${runId}`, '350.00', 5);
      await addToCart(token, productId, 2);
      const checkout = await createCheckout(token);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.body.orderNumber } });
      const reservation = await prisma.stockReservation.findFirstOrThrow({ where: { orderId: order.id } });
      // Simulate the reservation having already expired/been released.
      await prisma.stockReservation.update({ where: { id: reservation.id }, data: { status: 'RELEASED', releasedAt: new Date() } });
      await prisma.inventoryItem.update({ where: { id: reservation.inventoryItemId }, data: { availableQuantity: { increment: reservation.quantity }, reservedQuantity: { decrement: reservation.quantity } } });

      const retry = await api().post(`/api/v1/checkout/orders/${checkout.body.orderNumber}/retry-payment`).set('Authorization', auth(token));
      expect(retry.status).toBe(201);

      const freshReservations = await prisma.stockReservation.findMany({ where: { orderId: order.id, status: 'ACTIVE' } });
      expect(freshReservations).toHaveLength(1);
    });

    it("rejects retrying another customer's order", async () => {
      const owner = await createCustomer(`retry.ownerA.${runId}@example.com`, 'Secret123!');
      const intruder = await createCustomer(`retry.intruderB.${runId}@example.com`, 'Secret123!');
      const productId = await createProduct(`Retry Cross ${runId}`, '199.00', 10);
      await addToCart(owner, productId, 1);
      const checkout = await createCheckout(owner);

      const res = await api().post(`/api/v1/checkout/orders/${checkout.body.orderNumber}/retry-payment`).set('Authorization', auth(intruder));
      expect(res.status).toBe(404);
    });

    it('rejects retrying an already-CONFIRMED order', async () => {
      const token = await createCustomer(`retry.confirmed.${runId}@example.com`, 'Secret123!');
      const productId = await createProduct(`Retry Confirmed ${runId}`, '299.00', 10);
      await addToCart(token, productId, 1);
      const checkout = await createCheckout(token);
      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(paymentId, checkout.body.razorpayOrderId, 'captured');
      const signature = signPayment(checkout.body.razorpayOrderId, paymentId);
      await api()
        .post('/api/v1/payments/razorpay/verify')
        .set('Authorization', auth(token))
        .send({ orderNumber: checkout.body.orderNumber, razorpayOrderId: checkout.body.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: signature });

      const retry = await api().post(`/api/v1/checkout/orders/${checkout.body.orderNumber}/retry-payment`).set('Authorization', auth(token));
      expect(retry.status).toBe(409);
    });
  });

  describe('Concurrency (real PostgreSQL races)', () => {
    it('exactly one of two simultaneous checkouts for the final unit of stock succeeds', async () => {
      const tokenA = await createCustomer(`concurrent.A.${runId}@example.com`, 'Secret123!');
      const tokenB = await createCustomer(`concurrent.B.${runId}@example.com`, 'Secret123!');
      const productId = await createProduct(`Concurrent FinalStock ${runId}`, '999.00', 1);
      await addToCart(tokenA, productId, 1);
      await addToCart(tokenB, productId, 1);

      const [resA, resB] = await Promise.all([createCheckout(tokenA), createCheckout(tokenB)]);
      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const orders = await prisma.order.findMany({ where: { storeId, items: { some: { productId } } } });
      expect(orders).toHaveLength(1);
    });

    it('two simultaneous checkout requests for the same cart create exactly one order', async () => {
      const token = await createCustomer(`concurrent.samecart.${runId}@example.com`, 'Secret123!');
      const productId = await createProduct(`Concurrent SameCart ${runId}`, '499.00', 10);
      await addToCart(token, productId, 1);

      const [r1, r2] = await Promise.all([createCheckout(token), createCheckout(token)]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 400]); // the second sees the (by-then) empty cart

      const orders = await prisma.order.findMany({ where: { storeId, customerEmail: 'buyer@example.com', items: { some: { productId } } } });
      expect(orders).toHaveLength(1);
    });
  });

  describe('Order retrieval', () => {
    it('lists and fetches only the current customer\'s own orders, never internal ids', async () => {
      const token = await createCustomer(`orders.list.${runId}@example.com`, 'Secret123!');
      const productId = await createProduct(`Orders List ${runId}`, '150.00', 10);
      await addToCart(token, productId, 1);
      const checkout = await createCheckout(token);

      const list = await api().get('/api/v1/orders').set('Authorization', auth(token));
      expect(list.status).toBe(200);
      expect(list.body.items.some((o: { orderNumber: string }) => o.orderNumber === checkout.body.orderNumber)).toBe(true);

      const detail = await api().get(`/api/v1/orders/${checkout.body.orderNumber}`).set('Authorization', auth(token));
      expect(detail.status).toBe(200);
      expect(detail.body).not.toHaveProperty('id');
      expect(detail.body).not.toHaveProperty('userId');
      expect(JSON.stringify(detail.body)).not.toMatch(/costPrice/i);
    });

    it("returns 404 for another customer's orderNumber, never leaking its existence", async () => {
      const owner = await createCustomer(`orders.ownerA.${runId}@example.com`, 'Secret123!');
      const intruder = await createCustomer(`orders.intruderB.${runId}@example.com`, 'Secret123!');
      const productId = await createProduct(`Orders Cross ${runId}`, '150.00', 10);
      await addToCart(owner, productId, 1);
      const checkout = await createCheckout(owner);

      const res = await api().get(`/api/v1/orders/${checkout.body.orderNumber}`).set('Authorization', auth(intruder));
      expect(res.status).toBe(404);
    });

    it("Store B's JWT cannot see Store A's order", async () => {
      const token = await createCustomer(`orders.storeAuser.${runId}@example.com`, 'Secret123!');
      const productId = await createProduct(`Orders StoreIsolation ${runId}`, '150.00', 10);
      await addToCart(token, productId, 1);
      const checkout = await createCheckout(token);

      const storeB = await prisma.store.create({ data: { slug: `checkout-store-b-${runId}`, name: 'Checkout Store B', isActive: true } });
      const userB = await prisma.user.create({ data: { storeId: storeB.id, email: `checkoutb.${runId}@example.com`, passwordHash: 'x', type: 'CUSTOMER', isActive: true } });
      const storeBToken = await jwtService.signAsync(
        { sub: userB.id, storeId: storeB.id, email: userB.email, type: 'CUSTOMER', roles: [], permissions: [] },
        { secret: configService.get('jwt', { infer: true }).accessSecret, expiresIn: '15m', algorithm: 'HS256', issuer: 'peshani-api', audience: 'peshani-client' },
      );

      const res = await api().get(`/api/v1/orders/${checkout.body.orderNumber}`).set('Authorization', auth(storeBToken));
      expect(res.status).toBe(404);
    });
  });

  describe('PostgreSQL invariant verification', () => {
    it('every Order.totalAmount equals the sum of its OrderItem lineTotals plus shippingAmount minus discountAmount', async () => {
      // Phase 6 correction: shippingAmount can now be genuinely non-zero
      // (a selected ShippingMethod's server-authoritative price - see
      // phase6-fulfillment.e2e-spec.ts). Phase 7: discountAmount can now
      // also be genuinely non-zero (a redeemed Coupon - see
      // phase7-promotions.e2e-spec.ts, which shares this same store).
      // totalAmount = subtotal + shipping - discount was always the
      // documented formula (schema.prisma's own Order.totalAmount comment),
      // this suite just never previously had non-zero terms to verify.
      // taxAmount remains always 0 (no tax engine exists yet - unchanged
      // scope boundary).
      const orders = await prisma.order.findMany({ where: { storeId }, include: { items: true } });
      for (const order of orders) {
        const sum = order.items
          .reduce((acc, item) => acc.plus(item.lineTotal), new Prisma.Decimal(0))
          .plus(order.shippingAmount)
          .minus(order.discountAmount);
        expect(order.totalAmount.toFixed(2)).toBe(sum.toFixed(2));
      }
    });

    it('every OrderItem has quantity > 0 and lineTotal === unitPrice * quantity', async () => {
      const items = await prisma.orderItem.findMany({ where: { order: { storeId } } });
      for (const item of items) {
        expect(item.quantity).toBeGreaterThan(0);
        expect(item.lineTotal.toFixed(2)).toBe(item.unitPrice.times(item.quantity).toFixed(2));
      }
    });

    it('every Payment.amount/currency matches its Order.totalAmount/currency', async () => {
      const payments = await prisma.payment.findMany({ where: { storeId }, include: { order: true } });
      for (const payment of payments) {
        expect(payment.amount.toFixed(2)).toBe(payment.order.totalAmount.toFixed(2));
        expect(payment.currency).toBe(payment.order.currency);
      }
    });

    it('no order has more than one CAPTURED payment', async () => {
      const captured = await prisma.payment.groupBy({
        by: ['orderId'],
        where: { storeId, status: 'CAPTURED' },
        _count: { id: true },
        having: { id: { _count: { gt: 1 } } },
      });
      expect(captured).toEqual([]);
    });

    it('every StockReservation tagged with an order has quantity > 0', async () => {
      const bad = await prisma.stockReservation.count({ where: { storeId, orderId: { not: null }, quantity: { lte: 0 } } });
      expect(bad).toBe(0);
    });

    it('a CONFIRMED order always has at least one CAPTURED payment', async () => {
      const confirmedOrders = await prisma.order.findMany({ where: { storeId, status: 'CONFIRMED' }, include: { payments: true } });
      for (const order of confirmedOrders) {
        expect(order.payments.some((p) => p.status === 'CAPTURED')).toBe(true);
      }
    });
  });
});
