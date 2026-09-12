import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { DEFAULT_STORE_SLUG } from '../src/modules/store-settings/store-settings.service';
import { PAYMENT_PROVIDER } from '../src/modules/payments/providers/payment-provider.interface';
import { FakeRazorpayProvider, signPayment, signWebhookBody } from './helpers/fake-razorpay-provider';

/**
 * Phase 5 correction pass: Razorpay remote-order recovery (§2-§11, tests
 * R1-R8) and inventory reservation expiry (§12-§21, tests E1-E10, C1-C4).
 * Kept as its own file rather than appended to checkout.e2e-spec.ts given
 * its size - same conventions (runId-suffixed fixtures, real Postgres, a
 * swapped-in FakeRazorpayProvider for the two network-dependent operations
 * only - see that provider's own doc comment for why this isn't a bypass of
 * any verification).
 */
// Phase 9 added one extra outbox-event write to every order/payment
// transition this file exercises heavily (checkout, verify, recovery,
// expiry sweeps) - individually cheap, but in a full regression run
// (alongside every other suite's own added writes and this shared,
// ever-growing dev database) a few of this file's own already-close-to-
// the-default tests now occasionally exceed Jest's 5000ms default, though
// they pass reliably in isolation. Raised file-wide per Jest's own
// recommended practice; no assertion changed.
jest.setTimeout(20000);

describe('Peshani Payment Recovery & Reservation Expiry (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let inventoryService: InventoryService;
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
    const inventoryItem = await prisma.inventoryItem.create({
      data: { storeId, productId: product.id, variantId: null, warehouseId, onHandQuantity: available, availableQuantity: available, reservedQuantity: 0 },
    });
    return { productId: product.id, inventoryItemId: inventoryItem.id };
  }

  async function createCustomer(email: string, password: string) {
    const normalizedEmail = email.toLowerCase();
    const passwordHash = await argon2.hash(password);
    const role = await prisma.role.findUnique({ where: { storeId_name: { storeId, name: 'CUSTOMER' } } });
    const user = await prisma.user.create({ data: { storeId, email: normalizedEmail, passwordHash, type: 'CUSTOMER', isActive: true, emailVerifiedAt: new Date() } });
    if (role) await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const login = await api().post('/api/v1/auth/login').send({ email: normalizedEmail, password });
    return { token: login.body.accessToken as string, userId: user.id };
  }

  async function addToCart(token: string, productId: string, quantity: number) {
    await api().post('/api/v1/cart/items').set('Authorization', auth(token)).send({ productId, quantity });
  }

  async function createCheckout(token: string) {
    return api().post('/api/v1/checkout/create').set('Authorization', auth(token)).send({ email: 'recovery@example.com', billingAddress: address });
  }

  beforeAll(async () => {
    fakeProvider = new FakeRazorpayProvider();

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(fakeProvider)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    inventoryService = app.get(InventoryService);

    const store = await prisma.store.findUniqueOrThrow({ where: { slug: DEFAULT_STORE_SLUG } });
    storeId = store.id;

    const warehouse = await prisma.warehouse.create({ data: { storeId, name: `Recovery WH ${runId}`, code: `REC-WH-${runId}`, isActive: true, isDefault: true } });
    warehouseId = warehouse.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------
  // Razorpay remote-order recovery (R1-R8)
  // -------------------------------------------------------------------
  describe('Razorpay remote-order recovery', () => {
    it('R1/R2: a local Payment attempt is created and providerOrderId persists on a normal success', async () => {
      const { token } = await createCustomer(`recovery.r2.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`Recovery R2 ${runId}`, '500.00', 10);
      await addToCart(token, productId, 1);

      const res = await createCheckout(token);
      expect(res.status).toBe(201);

      const payment = await prisma.payment.findFirstOrThrow({ where: { providerOrderId: res.body.razorpayOrderId } });
      expect(payment.providerOrderId).toBe(res.body.razorpayOrderId);
      // Final micro-correction (§13): CREATED -> PENDING is now the atomic
      // claim a request takes before calling createOrder(), so it never
      // calls back to CREATED afterward - PENDING is the correct resting
      // status for a payment attempt whose provider order now exists, still
      // included in ACTIVE_PAYMENT_STATUSES so verify/retry treat it exactly
      // as before.
      expect(payment.status).toBe('PENDING');
    });

    it('R3/R4/R5: a lost create-response is recovered without a duplicate local Order or remote Razorpay order', async () => {
      const { token } = await createCustomer(`recovery.r3.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`Recovery R3 ${runId}`, '500.00', 10);
      await addToCart(token, productId, 1);

      // Simulate: Razorpay's side actually creates the order, but we never
      // get a usable response for it.
      fakeProvider.simulateLostResponseOnce = true;
      const remoteOrdersBefore = fakeProvider.distinctRemoteOrderCount;

      const res = await createCheckout(token);

      // createCheckout's own Phase B call already reconciles synchronously -
      // the customer never sees a failure for what was actually a successful
      // remote creation.
      expect(res.status).toBe(201);
      expect(res.body.razorpayOrderId).toBeDefined();

      // Exactly one new remote order was created for this attempt - the
      // reconciliation reused it, never created a second one (R5).
      expect(fakeProvider.distinctRemoteOrderCount).toBe(remoteOrdersBefore + 1);

      // Exactly one local Order and one local Payment attempt exist for it (R4).
      const orders = await prisma.order.findMany({ where: { storeId, items: { some: { productId } } } });
      expect(orders).toHaveLength(1);
      const payments = await prisma.payment.findMany({ where: { orderId: orders[0].id } });
      expect(payments).toHaveLength(1);
      expect(payments[0].providerOrderId).toBe(res.body.razorpayOrderId);
    });

    it('R6: repeated recovery (retry-payment on the same still-open attempt) is idempotent - no new attempt, no new remote order', async () => {
      const { token } = await createCustomer(`recovery.r6.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`Recovery R6 ${runId}`, '500.00', 10);
      await addToCart(token, productId, 1);

      fakeProvider.simulateLostResponseOnce = true;
      const checkout = await createCheckout(token);
      expect(checkout.status).toBe(201);

      const orderNumber = checkout.body.orderNumber;
      const remoteOrdersAfterFirst = fakeProvider.distinctRemoteOrderCount;
      const paymentsAfterFirst = await prisma.payment.count({ where: { order: { orderNumber } } });

      // Retrying now (the attempt is still CREATED, providerOrderId already
      // populated by the recovery above) must just return the SAME session,
      // never create a new Payment row or a new remote order.
      const retry = await api().post(`/api/v1/checkout/orders/${orderNumber}/retry-payment`).set('Authorization', auth(token));
      expect(retry.status).toBe(201);
      expect(retry.body.razorpayOrderId).toBe(checkout.body.razorpayOrderId);

      expect(fakeProvider.distinctRemoteOrderCount).toBe(remoteOrdersAfterFirst);
      const paymentsAfterSecond = await prisma.payment.count({ where: { order: { orderNumber } } });
      expect(paymentsAfterSecond).toBe(paymentsAfterFirst);
    });

    it('R7: a genuine retry after a terminally FAILED payment creates a NEW Payment attempt against the SAME Order', async () => {
      const { token } = await createCustomer(`recovery.r7.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`Recovery R7 ${runId}`, '500.00', 10);
      await addToCart(token, productId, 1);
      const checkout = await createCheckout(token);
      expect(checkout.status).toBe(201);

      // Fail the first attempt for real (invalid signature -> markFailed).
      const badVerify = await api()
        .post('/api/v1/payments/razorpay/verify')
        .set('Authorization', auth(token))
        .send({ orderNumber: checkout.body.orderNumber, razorpayOrderId: checkout.body.razorpayOrderId, razorpayPaymentId: 'pay_bad', razorpaySignature: 'f'.repeat(64) });
      expect(badVerify.status).toBe(400);

      const retry = await api().post(`/api/v1/checkout/orders/${checkout.body.orderNumber}/retry-payment`).set('Authorization', auth(token));
      expect(retry.status).toBe(201);
      expect(retry.body.razorpayOrderId).not.toBe(checkout.body.razorpayOrderId);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.body.orderNumber }, include: { payments: true } });
      expect(order.payments).toHaveLength(2);
      expect(order.payments.some((p) => p.status === 'FAILED')).toBe(true);
    });

    it('R8: a genuine (non-recoverable) provider failure releases the reservation and cancels the order', async () => {
      const { token } = await createCustomer(`recovery.r8.${runId}@example.com`, 'Secret123!');
      const { productId, inventoryItemId } = await createProduct(`Recovery R8 ${runId}`, '500.00', 10);
      await addToCart(token, productId, 2);

      fakeProvider.failNextCreateOrderPermanently = true;
      const res = await createCheckout(token);
      expect(res.status).toBe(503);

      const order = await prisma.order.findFirstOrThrow({ where: { storeId, items: { some: { productId } } } });
      expect(order.status).toBe('CANCELLED');

      const reservations = await prisma.stockReservation.findMany({ where: { orderId: order.id } });
      expect(reservations.every((r) => r.status === 'RELEASED')).toBe(true);

      const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(item.availableQuantity).toBe(10);
      expect(item.reservedQuantity).toBe(0);
    });

    it('reconciliation itself being unreachable returns a soft "retry in a moment" response, not a hard failure, and never cancels the order', async () => {
      const { token } = await createCustomer(`recovery.uncertain.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`Recovery Uncertain ${runId}`, '500.00', 10);
      await addToCart(token, productId, 1);

      fakeProvider.simulateLostResponseOnce = true;
      fakeProvider.failNextFetchByReceiptOnce = true;
      const res = await createCheckout(token);

      expect(res.status).toBe(503);
      expect(res.body.retryable).toBe(true);

      const order = await prisma.order.findFirstOrThrow({ where: { storeId, items: { some: { productId } } } });
      expect(order.status).toBe('PENDING_PAYMENT'); // NOT cancelled - genuinely unknown, not a confirmed failure.

      // A later retry (now that the provider is reachable again) recovers cleanly.
      const retry = await api().post(`/api/v1/checkout/orders/${order.orderNumber}/retry-payment`).set('Authorization', auth(token));
      expect(retry.status).toBe(201);
      expect(retry.body.razorpayOrderId).toBeDefined();
    });
  });

  // -------------------------------------------------------------------
  // Reservation expiry (E1-E10)
  // -------------------------------------------------------------------
  describe('Reservation expiry', () => {
    async function createExpiredReservation(inventoryItemId: string, quantity: number, expiresAt: Date) {
      // A reservation the sweep is scoped to (orderId set) needs a real
      // Order/OrderItem to attach to - build minimal ones directly.
      const { userId } = await createCustomer(`recovery.expiry.${runId}.${Math.random().toString(36).slice(2, 8)}@example.com`, 'Secret123!');
      // Internally consistent (unitPrice * quantity = lineTotal = order
      // totals) even though this is synthetic fixture data, not a real
      // checkout flow - checkout.e2e-spec.ts's own invariant tests scan the
      // WHOLE orders table for the store, so inconsistent dummy values here
      // would (and did, before this fix) show up as a false invariant failure there.
      const unitPrice = 10;
      const lineTotal = (unitPrice * quantity).toFixed(2);
      const order = await prisma.order.create({
        data: {
          storeId,
          userId,
          orderNumber: `PES-TEST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
          status: 'PENDING_PAYMENT',
          currency: 'INR',
          subtotal: lineTotal,
          totalAmount: lineTotal,
          customerEmail: 'expiry@example.com',
          billingAddress: {},
          shippingAddress: {},
        },
      });

      const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      const orderItem = await prisma.orderItem.create({
        data: { orderId: order.id, productId: item.productId, skuSnapshot: 'X', productNameSnapshot: 'X', quantity, unitPrice: unitPrice.toFixed(2), lineTotal, currency: 'INR' },
      });

      await prisma.inventoryItem.update({ where: { id: inventoryItemId }, data: { availableQuantity: { decrement: quantity }, reservedQuantity: { increment: quantity } } });
      const reservation = await prisma.stockReservation.create({
        data: { storeId, inventoryItemId, quantity, status: 'ACTIVE', expiresAt, orderId: order.id, orderItemId: orderItem.id },
      });
      return { reservation, orderId: order.id, userId };
    }

    it('E1/E2: an expired ACTIVE reservation is released by the sweep and no longer reduces availability', async () => {
      const { inventoryItemId } = await createProduct(`Expiry E1 ${runId}`, '10.00', 10);
      const { reservation } = await createExpiredReservation(inventoryItemId, 5, new Date(Date.now() - 60_000));

      let item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(item.reservedQuantity).toBe(5);
      expect(item.availableQuantity).toBe(5);

      const releasedCount = await inventoryService.sweepExpiredReservations(storeId);
      expect(releasedCount).toBeGreaterThanOrEqual(1);

      const updatedReservation = await prisma.stockReservation.findUniqueOrThrow({ where: { id: reservation.id } });
      expect(updatedReservation.status).toBe('RELEASED');

      item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(item.reservedQuantity).toBe(0);
      expect(item.availableQuantity).toBe(10);
    });

    it('E3: an unexpired ACTIVE reservation is left untouched by the sweep and still reduces availability', async () => {
      const { inventoryItemId } = await createProduct(`Expiry E3 ${runId}`, '10.00', 10);
      const { reservation } = await createExpiredReservation(inventoryItemId, 4, new Date(Date.now() + 60 * 60_000));

      await inventoryService.sweepExpiredReservations(storeId);

      const updatedReservation = await prisma.stockReservation.findUniqueOrThrow({ where: { id: reservation.id } });
      expect(updatedReservation.status).toBe('ACTIVE');

      const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(item.reservedQuantity).toBe(4);
      expect(item.availableQuantity).toBe(6);
    });

    it('E4: a COMMITTED reservation is never released by the sweep, even if its expiresAt has passed', async () => {
      const { inventoryItemId } = await createProduct(`Expiry E4 ${runId}`, '10.00', 10);
      const { reservation, orderId, userId } = await createExpiredReservation(inventoryItemId, 3, new Date(Date.now() - 60_000));

      // Commit it before it would otherwise be swept.
      await prisma.stockReservation.update({ where: { id: reservation.id }, data: { expiresAt: new Date(Date.now() + 60_000) } });
      await inventoryService.consume(storeId, reservation.id, { userId, storeId, email: '', type: 'CUSTOMER', roles: [], permissions: [] });
      await prisma.stockReservation.update({ where: { id: reservation.id }, data: { expiresAt: new Date(Date.now() - 60_000) } }); // now "expired" again, but COMMITTED

      await inventoryService.sweepExpiredReservations(storeId);

      const updatedReservation = await prisma.stockReservation.findUniqueOrThrow({ where: { id: reservation.id } });
      expect(updatedReservation.status).toBe('COMMITTED');
      void orderId;
    });

    it('E5: repeated sweeps are idempotent - no double-credit', async () => {
      const { inventoryItemId } = await createProduct(`Expiry E5 ${runId}`, '10.00', 10);
      await createExpiredReservation(inventoryItemId, 6, new Date(Date.now() - 60_000));

      await inventoryService.sweepExpiredReservations(storeId);
      const afterFirst = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      await inventoryService.sweepExpiredReservations(storeId);
      const afterSecond = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });

      expect(afterSecond.availableQuantity).toBe(afterFirst.availableQuantity);
      expect(afterSecond.reservedQuantity).toBe(afterFirst.reservedQuantity);
      expect(afterSecond.availableQuantity).toBe(10);
    });

    it('E6/C1: two concurrent sweeps release exactly once, never double-crediting', async () => {
      const { inventoryItemId } = await createProduct(`Expiry E6 ${runId}`, '10.00', 10);
      await createExpiredReservation(inventoryItemId, 7, new Date(Date.now() - 60_000));

      await Promise.all([inventoryService.sweepExpiredReservations(storeId), inventoryService.sweepExpiredReservations(storeId)]);

      const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(item.availableQuantity).toBe(10); // not 17 - a double-credit would show here immediately.
      expect(item.reservedQuantity).toBe(0);
    });

    it('E7/E9/C2: a concurrent consume() on an already-expired reservation loses to expiry - exactly one terminal transition, never silently committed', async () => {
      const { inventoryItemId } = await createProduct(`Expiry E7 ${runId}`, '10.00', 10);
      const { reservation, userId } = await createExpiredReservation(inventoryItemId, 5, new Date(Date.now() - 60_000));

      const actor = { userId, storeId, email: '', type: 'CUSTOMER' as const, roles: [], permissions: [] };
      const results = await Promise.allSettled([
        inventoryService.sweepExpiredReservations(storeId),
        inventoryService.consume(storeId, reservation.id, actor),
      ]);

      // consume() must never succeed on an already-expired reservation.
      const consumeResult = results[1];
      expect(consumeResult.status).toBe('rejected');

      const updatedReservation = await prisma.stockReservation.findUniqueOrThrow({ where: { id: reservation.id } });
      expect(updatedReservation.status).toBe('RELEASED');

      const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(item.availableQuantity).toBe(10);
      expect(item.reservedQuantity).toBe(0);
      expect(item.committedQuantity).toBe(0);
    });

    it('E8: two different reservations expiring simultaneously each restore exactly their own quantity', async () => {
      const { inventoryItemId } = await createProduct(`Expiry E8 ${runId}`, '10.00', 20);
      const { reservation: r1 } = await createExpiredReservation(inventoryItemId, 3, new Date(Date.now() - 60_000));
      const { reservation: r2 } = await createExpiredReservation(inventoryItemId, 4, new Date(Date.now() - 60_000));

      await inventoryService.sweepExpiredReservations(storeId);

      const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(item.availableQuantity).toBe(20);
      expect(item.reservedQuantity).toBe(0);
      const [ur1, ur2] = await Promise.all([
        prisma.stockReservation.findUniqueOrThrow({ where: { id: r1.id } }),
        prisma.stockReservation.findUniqueOrThrow({ where: { id: r2.id } }),
      ]);
      expect(ur1.status).toBe('RELEASED');
      expect(ur2.status).toBe('RELEASED');
    });

    it('C3: checkout cannot oversell against a stale expired reservation - lazy expiry frees the stock for a new checkout', async () => {
      const { productId, inventoryItemId } = await createProduct(`Expiry C3 ${runId}`, '50.00', 3);

      // This customer adds the item to their cart while stock is still
      // genuinely available (Phase 4's own cart-add availability check is
      // unrelated to this correction and must still pass here).
      const { token } = await createCustomer(`recovery.c3.${runId}@example.com`, 'Secret123!');
      await addToCart(token, productId, 3);

      // Only AFTER that, someone else's hold takes all 3 units and then
      // expires without ever being swept - exactly the scenario checkout's
      // own lazy sweep (not cart's) must handle correctly.
      await createExpiredReservation(inventoryItemId, 3, new Date(Date.now() - 60_000));

      const res = await createCheckout(token);
      expect(res.status).toBe(201); // would incorrectly 409 without the lazy pre-checkout sweep.
    });

    it('E10: database invariants hold after expiry processing', async () => {
      const items = await prisma.inventoryItem.findMany({ where: { storeId } });
      for (const item of items) {
        expect(item.onHandQuantity).toBeGreaterThanOrEqual(0);
        expect(item.reservedQuantity).toBeGreaterThanOrEqual(0);
        expect(item.availableQuantity).toBeGreaterThanOrEqual(0);
        expect(item.availableQuantity).toBe(item.onHandQuantity - item.reservedQuantity);
        expect(item.committedQuantity).toBeLessThanOrEqual(item.reservedQuantity);
      }

      const grouped = await prisma.stockReservation.groupBy({
        by: ['inventoryItemId'],
        where: { storeId, status: { in: ['ACTIVE', 'COMMITTED'] } },
        _sum: { quantity: true },
      });
      const heldByItemId = new Map(grouped.map((g) => [g.inventoryItemId, g._sum.quantity ?? 0]));
      for (const item of items) {
        expect(item.reservedQuantity).toBe(heldByItemId.get(item.id) ?? 0);
      }
    });
  });

  // -------------------------------------------------------------------
  // Recovery concurrency (C4)
  // -------------------------------------------------------------------
  describe('Recovery concurrency', () => {
    it('C4: two simultaneous recovery requests for the same interrupted attempt create no duplicate order and no duplicate side effects', async () => {
      const { token } = await createCustomer(`recovery.c4.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`Recovery C4 ${runId}`, '400.00', 10);
      await addToCart(token, productId, 1);

      fakeProvider.simulateLostResponseOnce = true;
      const checkout = await createCheckout(token);
      expect(checkout.status).toBe(201);
      const orderNumber = checkout.body.orderNumber;
      const remoteOrdersBefore = fakeProvider.distinctRemoteOrderCount;

      const [r1, r2] = await Promise.all([
        api().post(`/api/v1/checkout/orders/${orderNumber}/retry-payment`).set('Authorization', auth(token)),
        api().post(`/api/v1/checkout/orders/${orderNumber}/retry-payment`).set('Authorization', auth(token)),
      ]);
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect(r1.body.razorpayOrderId).toBe(r2.body.razorpayOrderId);

      expect(fakeProvider.distinctRemoteOrderCount).toBe(remoteOrdersBefore);
      const orders = await prisma.order.findMany({ where: { orderNumber } });
      expect(orders).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------
  // Final micro-correction - Issue A: payment/reservation finalization (F1-F7)
  // -------------------------------------------------------------------
  describe('Payment/reservation finalization', () => {
    /** Backdates an already-created, still-ACTIVE reservation's expiresAt - simulates its TTL having lapsed without touching anything else checkout produced. */
    async function expireReservationForItem(orderId: string, inventoryItemId: string) {
      await prisma.stockReservation.updateMany({
        where: { orderId, inventoryItemId, status: 'ACTIVE' },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
    }

    async function checkoutOne(email: string, price: string, available: number, quantity: number) {
      const { token } = await createCustomer(email, 'Secret123!');
      const { productId, inventoryItemId } = await createProduct(`Finalize ${email} ${runId}`, price, available);
      await addToCart(token, productId, quantity);
      const checkout = await createCheckout(token);
      expect(checkout.status).toBe(201);
      return { token, inventoryItemId, checkout: checkout.body };
    }

    function captureBody(checkout: { razorpayOrderId: string; orderNumber: string }, paymentId: string, signature: string) {
      return { orderNumber: checkout.orderNumber, razorpayOrderId: checkout.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: signature };
    }

    it('F1: successful payment with an active (non-expired) reservation commits it and confirms the order', async () => {
      const { token, inventoryItemId, checkout } = await checkoutOne(`fin.f1.${runId}@example.com`, '500.00', 5, 2);

      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(paymentId, checkout.razorpayOrderId, 'captured');
      const signature = signPayment(checkout.razorpayOrderId, paymentId);
      const verify = await api().post('/api/v1/payments/razorpay/verify').set('Authorization', auth(token)).send(captureBody(checkout, paymentId, signature));
      expect(verify.status).toBe(201);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.orderNumber }, include: { payments: true } });
      expect(order.status).toBe('CONFIRMED');
      expect(order.payments[0].status).toBe('CAPTURED');
      const reservations = await prisma.stockReservation.findMany({ where: { orderId: order.id } });
      expect(reservations.every((r) => r.status === 'COMMITTED')).toBe(true);
      const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(item.committedQuantity).toBe(2);
    });

    it('F2: payment verification races with reservation expiry - exactly one terminal reservation transition, no overselling', async () => {
      const { token, inventoryItemId, checkout } = await checkoutOne(`fin.f2.${runId}@example.com`, '500.00', 5, 2);
      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.orderNumber } });
      await expireReservationForItem(order.id, inventoryItemId);

      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(paymentId, checkout.razorpayOrderId, 'captured');
      const signature = signPayment(checkout.razorpayOrderId, paymentId);
      const body = captureBody(checkout, paymentId, signature);

      const [a, b] = await Promise.all([
        api().post('/api/v1/payments/razorpay/verify').set('Authorization', auth(token)).send(body),
        api().post('/api/v1/payments/razorpay/verify').set('Authorization', auth(token)).send(body),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);

      const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(finalOrder.status).toBe('PENDING_PAYMENT'); // never falsely confirmed once expiry has genuinely won.

      const reservations = await prisma.stockReservation.findMany({ where: { orderId: order.id } });
      expect(reservations).toHaveLength(1);
      expect(reservations[0].status).toBe('RELEASED'); // exactly one terminal transition - never stuck ACTIVE, never COMMITTED.

      const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(item.reservedQuantity).toBe(0); // credited back exactly once - no double-credit from the two racing verify calls.
      expect(item.availableQuantity).toBe(5); // no oversell, no negative.
    });

    it('F3: a reservation that already expired before payment finalization must not falsely confirm the order', async () => {
      const { token, inventoryItemId, checkout } = await checkoutOne(`fin.f3.${runId}@example.com`, '500.00', 5, 1);
      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.orderNumber } });
      await expireReservationForItem(order.id, inventoryItemId);

      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(paymentId, checkout.razorpayOrderId, 'captured');
      const signature = signPayment(checkout.razorpayOrderId, paymentId);
      const verify = await api().post('/api/v1/payments/razorpay/verify').set('Authorization', auth(token)).send(captureBody(checkout, paymentId, signature));
      expect(verify.status).toBe(201);

      const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(finalOrder.status).toBe('PENDING_PAYMENT');
      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
      expect(payment.status).toBe('CAPTURED'); // real money captured by the provider is never silently discarded.
      const reservation = await prisma.stockReservation.findFirstOrThrow({ where: { orderId: order.id } });
      expect(reservation.status).toBe('RELEASED');
    });

    it('F4: payment succeeds while one line of a multi-item order has an expired reservation - no false confirmation, no partial commit, no inventory corruption', async () => {
      const { token } = await createCustomer(`fin.f4.${runId}@example.com`, 'Secret123!');
      const { productId: productA, inventoryItemId: itemA } = await createProduct(`Finalize F4 A ${runId}`, '300.00', 5);
      const { productId: productB, inventoryItemId: itemB } = await createProduct(`Finalize F4 B ${runId}`, '200.00', 5);
      await addToCart(token, productA, 1);
      await addToCart(token, productB, 1);
      const checkout = await createCheckout(token);
      expect(checkout.status).toBe(201);
      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.body.orderNumber } });

      // Only line B's hold lapses - line A's remains perfectly valid.
      await expireReservationForItem(order.id, itemB);

      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(paymentId, checkout.body.razorpayOrderId, 'captured');
      const signature = signPayment(checkout.body.razorpayOrderId, paymentId);
      const verify = await api()
        .post('/api/v1/payments/razorpay/verify')
        .set('Authorization', auth(token))
        .send(captureBody(checkout.body, paymentId, signature));
      expect(verify.status).toBe(201);

      const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(finalOrder.status).toBe('PENDING_PAYMENT'); // NOT confirmed - all-or-nothing (§8/§9): one bad line blocks the whole order.

      const reservations = await prisma.stockReservation.findMany({ where: { orderId: order.id } });
      const resA = reservations.find((r) => r.inventoryItemId === itemA)!;
      const resB = reservations.find((r) => r.inventoryItemId === itemB)!;
      // Line A was NOT committed even though it was individually still
      // valid - no partial commit ever sits alongside an unconfirmed order.
      expect(resA.status).toBe('ACTIVE');
      expect(resB.status).toBe('RELEASED');

      const invA = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemA } });
      const invB = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemB } });
      expect(invA.reservedQuantity).toBe(1); // still legitimately held, unconsumed - not silently released.
      expect(invA.committedQuantity).toBe(0);
      expect(invB.reservedQuantity).toBe(0); // credited back, no double-credit.
      expect(invB.availableQuantity).toBe(5); // no negative, no oversell.
    });

    it('F5: a successful payment followed by a repeated verify call is idempotent - no double reservation commit', async () => {
      const { token, inventoryItemId, checkout } = await checkoutOne(`fin.f5.${runId}@example.com`, '500.00', 5, 1);
      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(paymentId, checkout.razorpayOrderId, 'captured');
      const signature = signPayment(checkout.razorpayOrderId, paymentId);
      const body = captureBody(checkout, paymentId, signature);

      const first = await api().post('/api/v1/payments/razorpay/verify').set('Authorization', auth(token)).send(body);
      const second = await api().post('/api/v1/payments/razorpay/verify').set('Authorization', auth(token)).send(body);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);

      const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(item.committedQuantity).toBe(1);
      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.orderNumber } });
      expect(order.status).toBe('CONFIRMED');
    });

    it('F6: a successful payment verified via the client callback AND a payment.captured webhook simultaneously results in exactly one finalization', async () => {
      const { token, inventoryItemId, checkout } = await checkoutOne(`fin.f6.${runId}@example.com`, '500.00', 5, 1);
      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(paymentId, checkout.razorpayOrderId, 'captured');
      const signature = signPayment(checkout.razorpayOrderId, paymentId);
      const amount = Math.round(Number(checkout.amount) * 100);
      const webhookBody = JSON.stringify({
        id: `evt_f6_${runId}`,
        event: 'payment.captured',
        payload: { payment: { entity: { id: paymentId, order_id: checkout.razorpayOrderId, amount, currency: checkout.currency, status: 'captured' } } },
      });
      const webhookSignature = signWebhookBody(webhookBody);

      const [verifyRes, webhookRes] = await Promise.all([
        api().post('/api/v1/payments/razorpay/verify').set('Authorization', auth(token)).send(captureBody(checkout, paymentId, signature)),
        api().post('/api/v1/payments/razorpay/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', webhookSignature).send(webhookBody),
      ]);
      expect(verifyRes.status).toBe(201);
      expect(webhookRes.status).toBe(200);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.orderNumber } });
      expect(order.status).toBe('CONFIRMED');
      const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(item.committedQuantity).toBe(1); // exactly once, never double-consumed by the race.
    });

    it('F7: a payment.captured webhook arriving after its reservation has already expired resolves deterministically without a false confirmation', async () => {
      const { checkout } = await checkoutOne(`fin.f7.${runId}@example.com`, '500.00', 5, 1);
      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.orderNumber } });
      const reservationBefore = await prisma.stockReservation.findFirstOrThrow({ where: { orderId: order.id } });
      await expireReservationForItem(order.id, reservationBefore.inventoryItemId);

      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(paymentId, checkout.razorpayOrderId, 'captured');
      const amount = Math.round(Number(checkout.amount) * 100);
      const webhookBody = JSON.stringify({
        id: `evt_f7_${runId}`,
        event: 'payment.captured',
        payload: { payment: { entity: { id: paymentId, order_id: checkout.razorpayOrderId, amount, currency: checkout.currency, status: 'captured' } } },
      });
      const signature = signWebhookBody(webhookBody);

      const res = await api().post('/api/v1/payments/razorpay/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', signature).send(webhookBody);
      expect(res.status).toBe(200); // webhook ack - Razorpay doesn't need to know our internal reconciliation state.

      const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(finalOrder.status).toBe('PENDING_PAYMENT');
      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
      expect(payment.status).toBe('CAPTURED');
      const reservation = await prisma.stockReservation.findFirstOrThrow({ where: { orderId: order.id } });
      expect(reservation.status).toBe('RELEASED');
    });
  });

  // -------------------------------------------------------------------
  // Final micro-correction - Issue B: concurrent same-Payment recovery (G1-G5)
  // -------------------------------------------------------------------
  describe('Concurrent payment recovery', () => {
    /**
     * Directly constructs a PENDING_PAYMENT order with a valid ACTIVE
     * reservation and an open (CREATED, providerOrderId null) Payment attempt
     * - the exact precondition §12 describes ("Payment.providerOrderId =
     * NULL") - without needing a real checkout call (which would populate
     * providerOrderId synchronously in the same request, leaving no window
     * to race two separate HTTP calls against it).
     */
    async function createPendingOrderWithOpenPayment(userId: string, inventoryItemId: string, quantity: number) {
      const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      const unitPrice = 500;
      const lineTotal = (unitPrice * quantity).toFixed(2);
      const order = await prisma.order.create({
        data: {
          storeId,
          userId,
          orderNumber: `PES-TEST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
          status: 'PENDING_PAYMENT',
          currency: 'INR',
          subtotal: lineTotal,
          totalAmount: lineTotal,
          customerEmail: 'concurrent.recovery@example.com',
          billingAddress: {},
          shippingAddress: {},
        },
      });
      const orderItem = await prisma.orderItem.create({
        data: { orderId: order.id, productId: item.productId, skuSnapshot: 'X', productNameSnapshot: 'X', quantity, unitPrice: unitPrice.toFixed(2), lineTotal, currency: 'INR' },
      });
      await prisma.inventoryItem.update({ where: { id: inventoryItemId }, data: { availableQuantity: { decrement: quantity }, reservedQuantity: { increment: quantity } } });
      await prisma.stockReservation.create({
        data: { storeId, inventoryItemId, quantity, status: 'ACTIVE', expiresAt: new Date(Date.now() + 15 * 60_000), orderId: order.id, orderItemId: orderItem.id },
      });
      await prisma.payment.create({
        data: { storeId, orderId: order.id, provider: 'RAZORPAY', providerOrderId: null, amount: lineTotal, currency: 'INR', status: 'CREATED' },
      });
      return order.orderNumber;
    }

    it('G1: two concurrent recovery requests for the same Payment produce exactly one local Payment, one Order, and one remote provider order', async () => {
      const { token, userId } = await createCustomer(`concurrent.g1.${runId}@example.com`, 'Secret123!');
      const { inventoryItemId } = await createProduct(`Concurrent G1 ${runId}`, '500.00', 10);
      const orderNumber = await createPendingOrderWithOpenPayment(userId, inventoryItemId, 1);

      const callsBefore = fakeProvider.createOrderCallCount;
      const remoteOrdersBefore = fakeProvider.distinctRemoteOrderCount;
      // Slow the winner down just enough that the loser genuinely exercises
      // its poll-and-reuse path rather than finding the result already there.
      fakeProvider.nextCreateOrderDelayMs = 300;

      const [a, b] = await Promise.all([
        api().post(`/api/v1/checkout/orders/${orderNumber}/retry-payment`).set('Authorization', auth(token)),
        api().post(`/api/v1/checkout/orders/${orderNumber}/retry-payment`).set('Authorization', auth(token)),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.razorpayOrderId).toBe(b.body.razorpayOrderId);

      // Provider call count: exactly one createOrder() call resulted from
      // BOTH concurrent requests - the loser never called it (§19).
      expect(fakeProvider.createOrderCallCount - callsBefore).toBe(1);
      expect(fakeProvider.distinctRemoteOrderCount).toBe(remoteOrdersBefore + 1);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber } });
      const payments = await prisma.payment.findMany({ where: { orderId: order.id } });
      expect(payments).toHaveLength(1);
      const orders = await prisma.order.count({ where: { orderNumber } });
      expect(orders).toBe(1);
    });

    it('G2: two concurrent recovery requests when the winning attempt loses its own response are recovered to one remote order, no duplicate Order', async () => {
      const { token, userId } = await createCustomer(`concurrent.g2.${runId}@example.com`, 'Secret123!');
      const { inventoryItemId } = await createProduct(`Concurrent G2 ${runId}`, '500.00', 10);
      const orderNumber = await createPendingOrderWithOpenPayment(userId, inventoryItemId, 1);

      const callsBefore = fakeProvider.createOrderCallCount;
      const remoteOrdersBefore = fakeProvider.distinctRemoteOrderCount;
      fakeProvider.nextCreateOrderDelayMs = 300;
      fakeProvider.simulateLostResponseOnce = true;

      const [a, b] = await Promise.all([
        api().post(`/api/v1/checkout/orders/${orderNumber}/retry-payment`).set('Authorization', auth(token)),
        api().post(`/api/v1/checkout/orders/${orderNumber}/retry-payment`).set('Authorization', auth(token)),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.razorpayOrderId).toBe(b.body.razorpayOrderId);

      expect(fakeProvider.createOrderCallCount - callsBefore).toBe(1);
      expect(fakeProvider.distinctRemoteOrderCount).toBe(remoteOrdersBefore + 1);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber } });
      const payments = await prisma.payment.findMany({ where: { orderId: order.id } });
      expect(payments).toHaveLength(1);
      const orders = await prisma.order.count({ where: { orderNumber } });
      expect(orders).toBe(1);
    });

    it('G3: recovery repeated 5 times concurrently produces no duplicate local side effects', async () => {
      const { token, userId } = await createCustomer(`concurrent.g3.${runId}@example.com`, 'Secret123!');
      const { inventoryItemId } = await createProduct(`Concurrent G3 ${runId}`, '500.00', 10);
      const orderNumber = await createPendingOrderWithOpenPayment(userId, inventoryItemId, 1);

      const callsBefore = fakeProvider.createOrderCallCount;
      fakeProvider.nextCreateOrderDelayMs = 300;

      const results = await Promise.all(
        Array.from({ length: 5 }, () => api().post(`/api/v1/checkout/orders/${orderNumber}/retry-payment`).set('Authorization', auth(token))),
      );
      for (const res of results) expect(res.status).toBe(201);
      const distinctRazorpayOrderIds = new Set(results.map((r) => r.body.razorpayOrderId));
      expect(distinctRazorpayOrderIds.size).toBe(1);

      expect(fakeProvider.createOrderCallCount - callsBefore).toBe(1);
      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber } });
      const payments = await prisma.payment.findMany({ where: { orderId: order.id } });
      expect(payments).toHaveLength(1);
    });

    it('G4: recovery after providerOrderId has already been persisted makes no new provider order', async () => {
      const { token, userId } = await createCustomer(`concurrent.g4.${runId}@example.com`, 'Secret123!');
      const { inventoryItemId } = await createProduct(`Concurrent G4 ${runId}`, '500.00', 10);
      const orderNumber = await createPendingOrderWithOpenPayment(userId, inventoryItemId, 1);

      const first = await api().post(`/api/v1/checkout/orders/${orderNumber}/retry-payment`).set('Authorization', auth(token));
      expect(first.status).toBe(201);
      const callsAfterFirst = fakeProvider.createOrderCallCount;

      const second = await api().post(`/api/v1/checkout/orders/${orderNumber}/retry-payment`).set('Authorization', auth(token));
      expect(second.status).toBe(201);
      expect(second.body.razorpayOrderId).toBe(first.body.razorpayOrderId);
      expect(fakeProvider.createOrderCallCount).toBe(callsAfterFirst);
    });

    it('G5: recovery of a still-open attempt never creates a new Payment, but a genuine retry after a terminal FAILED attempt does', async () => {
      const { token, userId } = await createCustomer(`concurrent.g5.${runId}@example.com`, 'Secret123!');
      const { inventoryItemId } = await createProduct(`Concurrent G5 ${runId}`, '500.00', 10);
      const orderNumber = await createPendingOrderWithOpenPayment(userId, inventoryItemId, 1);

      const recovered = await api().post(`/api/v1/checkout/orders/${orderNumber}/retry-payment`).set('Authorization', auth(token));
      expect(recovered.status).toBe(201);
      let order = await prisma.order.findUniqueOrThrow({ where: { orderNumber }, include: { payments: true } });
      expect(order.payments).toHaveLength(1); // recovery reused the existing attempt - no new Payment.

      const badVerify = await api()
        .post('/api/v1/payments/razorpay/verify')
        .set('Authorization', auth(token))
        .send({ orderNumber, razorpayOrderId: recovered.body.razorpayOrderId, razorpayPaymentId: 'pay_bad', razorpaySignature: 'f'.repeat(64) });
      expect(badVerify.status).toBe(400);

      const genuineRetry = await api().post(`/api/v1/checkout/orders/${orderNumber}/retry-payment`).set('Authorization', auth(token));
      expect(genuineRetry.status).toBe(201);
      expect(genuineRetry.body.razorpayOrderId).not.toBe(recovered.body.razorpayOrderId);

      order = await prisma.order.findUniqueOrThrow({ where: { orderNumber }, include: { payments: true } });
      expect(order.payments).toHaveLength(2); // the genuine retry after a terminal FAILED DID create a new Payment.
      expect(order.payments.some((p) => p.status === 'FAILED')).toBe(true);
    });
  });
});
