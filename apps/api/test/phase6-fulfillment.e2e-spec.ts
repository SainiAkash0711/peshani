import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppConfig } from '../src/config/configuration';
import { DEFAULT_STORE_SLUG } from '../src/modules/store-settings/store-settings.service';
import { PAYMENT_PROVIDER } from '../src/modules/payments/providers/payment-provider.interface';
import { FakeRazorpayProvider, signPayment } from './helpers/fake-razorpay-provider';

/**
 * Phase 6 - Shipping, Admin Order Management & Fulfillment (e2e).
 * Covers: shipping-method CRUD/tenant-isolation/server-authoritative price,
 * checkout shipping integration, the order status transition matrix,
 * OrderStatusHistory, fulfillment (idempotent, multi-item, atomic),
 * cancellation (admin + customer), and the required concurrency races
 * (Phase 6 §34 Race 1-6).
 */
describe('Peshani Phase 6 - Shipping & Order Fulfillment (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService<AppConfig, true>;
  let fakeProvider: FakeRazorpayProvider;
  let storeId: string;
  let warehouseId: string;
  let adminToken: string;

  const runId = Date.now();
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => `Bearer ${token}`;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peshani.example';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

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
      data: { storeId, name, slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${runId}-${Math.random().toString(36).slice(2, 8)}`, sku: `${name.replace(/\s+/g, '')}-${runId}-${Math.random().toString(36).slice(2, 6)}`, status: 'ACTIVE', productType: 'SIMPLE', basePrice: price },
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

  async function createCheckout(token: string, shippingMethodId?: string) {
    return api()
      .post('/api/v1/checkout/create')
      .set('Authorization', auth(token))
      .send({ email: 'buyer@example.com', billingAddress: address, ...(shippingMethodId ? { shippingMethodId } : {}) });
  }

  /** Checks out, then completes payment via a signed fake capture, returning the CONFIRMED order number. */
  async function checkoutAndConfirm(token: string, productId: string, quantity = 1, shippingMethodId?: string) {
    await addToCart(token, productId, quantity);
    const checkout = await createCheckout(token, shippingMethodId);
    expect(checkout.status).toBe(201);

    const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
    fakeProvider.registerPayment(paymentId, checkout.body.razorpayOrderId, 'captured');
    const signature = signPayment(checkout.body.razorpayOrderId, paymentId);
    const verify = await api()
      .post('/api/v1/payments/razorpay/verify')
      .set('Authorization', auth(token))
      .send({ orderNumber: checkout.body.orderNumber, razorpayOrderId: checkout.body.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: signature });
    expect(verify.status).toBe(201);
    expect(verify.body.status).toBe('CONFIRMED');

    return checkout.body.orderNumber as string;
  }

  async function createShippingMethod(name: string, price: string, isActive = true) {
    const res = await api()
      .post('/api/v1/shipping-methods')
      .set('Authorization', auth(adminToken))
      .send({ name, code: `SM-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, price, isActive });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function createLimitedAdmin(storeIdForRole: string, permissionKeys: string[], email: string) {
    const perms = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });
    const role = await prisma.role.create({ data: { storeId: storeIdForRole, name: `ROLE-${Math.random().toString(36).slice(2, 8)}` } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    const user = await prisma.user.create({
      data: { storeId: storeIdForRole, email, passwordHash: await argon2.hash('irrelevant'), type: 'ADMIN', isActive: true, emailVerifiedAt: new Date() },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const token = await jwtService.signAsync(
      { sub: user.id, storeId: storeIdForRole, email: user.email, type: 'ADMIN', roles: [role.name], permissions: perms.map((p) => p.key) },
      { secret: configService.get('jwt', { infer: true }).accessSecret, expiresIn: '15m', algorithm: 'HS256', issuer: 'peshani-api', audience: 'peshani-client' },
    );
    return { token, userId: user.id };
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
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService<AppConfig, true>);

    const store = await prisma.store.findUniqueOrThrow({ where: { slug: DEFAULT_STORE_SLUG } });
    storeId = store.id;

    const warehouse = await prisma.warehouse.create({ data: { storeId, name: `Phase6 WH ${runId}`, code: `P6-WH-${runId}`, isActive: true, isDefault: true } });
    warehouseId = warehouse.id;

    const adminLogin = await api().post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------
  // Shipping methods - CRUD, validation, permissions, tenant isolation
  // -------------------------------------------------------------------
  describe('Shipping methods', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await api().post('/api/v1/shipping-methods').send({ name: 'X', code: `X-${runId}`, price: '10.00' });
      expect(res.status).toBe(401);
    });

    it('rejects a customer (no shipping_method permissions)', async () => {
      const { token } = await createCustomer(`ship.customer.${runId}@example.com`, 'Secret123!');
      const res = await api().post('/api/v1/shipping-methods').set('Authorization', auth(token)).send({ name: 'X', code: `X-${runId}`, price: '10.00' });
      expect(res.status).toBe(403);
    });

    it('creates, lists, updates, and reads back a shipping method', async () => {
      const created = await createShippingMethod(`Standard ${runId}`, '49.00');
      expect(created.price).toBe('49.00');
      expect(created.isActive).toBe(true);

      const list = await api().get('/api/v1/shipping-methods').set('Authorization', auth(adminToken)).query({ search: `Standard ${runId}` });
      expect(list.status).toBe(200);
      expect(list.body.items.some((m: { id: string }) => m.id === created.id)).toBe(true);

      const updated = await api().patch(`/api/v1/shipping-methods/${created.id}`).set('Authorization', auth(adminToken)).send({ price: '59.00' });
      expect(updated.status).toBe(200);
      expect(updated.body.price).toBe('59.00');

      const fetched = await api().get(`/api/v1/shipping-methods/${created.id}`).set('Authorization', auth(adminToken));
      expect(fetched.body.price).toBe('59.00');
    });

    it('rejects a duplicate code within the same store', async () => {
      const code = `DUP-${runId}`;
      const first = await api().post('/api/v1/shipping-methods').set('Authorization', auth(adminToken)).send({ name: 'First', code, price: '10.00' });
      expect(first.status).toBe(201);
      const second = await api().post('/api/v1/shipping-methods').set('Authorization', auth(adminToken)).send({ name: 'Second', code, price: '20.00' });
      expect(second.status).toBe(409);
    });

    it('activates/deactivates via the status endpoint', async () => {
      const created = await createShippingMethod(`Express ${runId}`, '99.00');
      const deactivated = await api().patch(`/api/v1/shipping-methods/${created.id}/status`).set('Authorization', auth(adminToken)).send({ isActive: false });
      expect(deactivated.status).toBe(200);
      expect(deactivated.body.isActive).toBe(false);

      const reactivated = await api().patch(`/api/v1/shipping-methods/${created.id}/status`).set('Authorization', auth(adminToken)).send({ isActive: true });
      expect(reactivated.body.isActive).toBe(true);
    });

    it('soft-deletes a method not referenced by any order', async () => {
      const created = await createShippingMethod(`Deletable ${runId}`, '15.00');
      const res = await api().delete(`/api/v1/shipping-methods/${created.id}`).set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);

      const fetchAfter = await api().get(`/api/v1/shipping-methods/${created.id}`).set('Authorization', auth(adminToken));
      expect(fetchAfter.status).toBe(404);
    });

    it('refuses to delete a method referenced by an existing order', async () => {
      const method = await createShippingMethod(`Referenced ${runId}`, '25.00');
      const { token } = await createCustomer(`ship.ref.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ShipRef Product ${runId}`, '100.00', 10);
      await addToCart(token, productId, 1);
      const checkout = await createCheckout(token, method.id);
      expect(checkout.status).toBe(201);

      const res = await api().delete(`/api/v1/shipping-methods/${method.id}`).set('Authorization', auth(adminToken));
      expect(res.status).toBe(409);
    });

    it("the public /available endpoint returns only active methods, no auth required", async () => {
      const active = await createShippingMethod(`PublicActive ${runId}`, '30.00', true);
      const inactive = await createShippingMethod(`PublicInactive ${runId}`, '30.00', false);

      const res = await api().get('/api/v1/shipping-methods/available');
      expect(res.status).toBe(200);
      const ids: string[] = res.body.map((m: { id: string }) => m.id);
      expect(ids).toContain(active.id);
      expect(ids).not.toContain(inactive.id);
    });

    it("Store B's admin cannot see or modify Store A's shipping method (tenant isolation)", async () => {
      const method = await createShippingMethod(`TenantIsolated ${runId}`, '40.00');
      const storeB = await prisma.store.create({ data: { slug: `store-b-ship-${runId}`, name: 'Store B', isActive: true } });
      const { token: storeBToken } = await createLimitedAdmin(storeB.id, ['shipping_method.read', 'shipping_method.update', 'shipping_method.delete'], `storeb.ship.${runId}@example.com`);

      const fetch = await api().get(`/api/v1/shipping-methods/${method.id}`).set('Authorization', auth(storeBToken));
      expect(fetch.status).toBe(404);

      const update = await api().patch(`/api/v1/shipping-methods/${method.id}`).set('Authorization', auth(storeBToken)).send({ price: '1.00' });
      expect(update.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // Shipping price integrated into checkout - server-authoritative
  // -------------------------------------------------------------------
  describe('Checkout shipping integration', () => {
    it('omitting shippingMethodId preserves pre-Phase-6 behavior exactly (shippingAmount 0, totalAmount = subtotal)', async () => {
      const { token } = await createCustomer(`ship.omit.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`NoShip ${runId}`, '200.00', 10);
      await addToCart(token, productId, 1);
      const checkout = await createCheckout(token);
      expect(checkout.status).toBe(201);
      expect(checkout.body.amount).toBe('200.00');

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.body.orderNumber } });
      expect(order.shippingAmount.toFixed(2)).toBe('0.00');
      expect(order.totalAmount.toFixed(2)).toBe('200.00');
      expect(order.shippingMethodId).toBeNull();
    });

    it('a selected shipping method adds its price to the order total and Razorpay amount, and snapshots its name', async () => {
      const method = await createShippingMethod(`Checkout Ship ${runId}`, '75.50');
      const { token } = await createCustomer(`ship.selected.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ShipSelected ${runId}`, '200.00', 10);
      await addToCart(token, productId, 1);

      const checkout = await createCheckout(token, method.id);
      expect(checkout.status).toBe(201);
      expect(checkout.body.amount).toBe('275.50');

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.body.orderNumber }, include: { payments: true } });
      expect(order.shippingAmount.toFixed(2)).toBe('75.50');
      expect(order.totalAmount.toFixed(2)).toBe('275.50');
      expect(order.shippingMethodId).toBe(method.id);
      expect(order.shippingMethodNameSnapshot).toBe(method.name);
      expect(order.payments[0].amount.toFixed(2)).toBe('275.50');
    });

    it('rejects checkout with a deactivated shipping method (Race 5) - the client can never force an unavailable method', async () => {
      const method = await createShippingMethod(`ToDeactivate ${runId}`, '20.00', false);
      const { token } = await createCustomer(`ship.deactivated.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ShipDeactivated ${runId}`, '100.00', 10);
      await addToCart(token, productId, 1);

      const checkout = await createCheckout(token, method.id);
      expect(checkout.status).toBe(409);
    });

    it('rejects checkout with an unknown/nonexistent shippingMethodId', async () => {
      const { token } = await createCustomer(`ship.unknown.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ShipUnknown ${runId}`, '100.00', 10);
      await addToCart(token, productId, 1);

      const checkout = await createCheckout(token, '00000000-0000-0000-0000-000000000000');
      expect(checkout.status).toBe(409);
    });

    it('the client cannot submit an arbitrary shippingAmount - the DTO does not even accept one', async () => {
      const { token } = await createCustomer(`ship.manipulated.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ShipManipulated ${runId}`, '100.00', 10);
      await addToCart(token, productId, 1);

      const res = await api()
        .post('/api/v1/checkout/create')
        .set('Authorization', auth(token))
        .send({ email: 'buyer@example.com', billingAddress: address, shippingAmount: '999999.00' });
      // forbidNonWhitelisted rejects the unknown field outright.
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------
  // Order status transition matrix, history, security
  // -------------------------------------------------------------------
  describe('Order status transitions', () => {
    it('rejects an invalid transition (CONFIRMED -> SHIPPED, skipping the matrix)', async () => {
      const { token } = await createCustomer(`status.invalid.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`StatusInvalid ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(token, productId);

      const res = await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'SHIPPED' });
      expect(res.status).toBe(409);
    });

    it('rejects transitioning a still-unpaid order to PROCESSING', async () => {
      const { token } = await createCustomer(`status.unpaid.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`StatusUnpaid ${runId}`, '100.00', 10);
      await addToCart(token, productId, 1);
      const checkout = await createCheckout(token);
      expect(checkout.status).toBe(201);

      const res = await api().patch(`/api/v1/admin/orders/${checkout.body.orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' });
      expect(res.status).toBe(409);
    });

    it('performs the full valid lifecycle CONFIRMED -> PROCESSING -> PACKED (fulfill) -> SHIPPED -> DELIVERED, recording history at every step', async () => {
      const { token } = await createCustomer(`status.lifecycle.${runId}@example.com`, 'Secret123!');
      const { productId, inventoryItemId } = await createProduct(`StatusLifecycle ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(token, productId, 2);

      const processing = await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' });
      expect(processing.status).toBe(200);
      expect(processing.body.status).toBe('PROCESSING');

      const itemBeforeFulfill = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });

      const fulfilled = await api().post(`/api/v1/admin/orders/${orderNumber}/fulfill`).set('Authorization', auth(adminToken)).send({});
      expect(fulfilled.status).toBe(201);
      expect(fulfilled.body.status).toBe('PACKED');

      const itemAfterFulfill = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(itemAfterFulfill.onHandQuantity).toBe(itemBeforeFulfill.onHandQuantity - 2);
      expect(itemAfterFulfill.reservedQuantity).toBe(itemBeforeFulfill.reservedQuantity - 2);
      expect(itemAfterFulfill.committedQuantity).toBe(itemBeforeFulfill.committedQuantity - 2);
      expect(itemAfterFulfill.availableQuantity).toBe(itemBeforeFulfill.availableQuantity); // fulfillment never touches available - it was already spent at reserve-time.

      const shipped = await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'SHIPPED' });
      expect(shipped.status).toBe(200);
      expect(shipped.body.status).toBe('SHIPPED');

      const delivered = await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'DELIVERED' });
      expect(delivered.status).toBe(200);
      expect(delivered.body.status).toBe('DELIVERED');

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber } });
      const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
      expect(history.map((h) => h.newStatus)).toEqual(['PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED']);
      expect(history.every((h) => h.source === 'ADMIN')).toBe(true);
      expect(history[1].previousStatus).toBe('PROCESSING');
      expect(history[1].newStatus).toBe('PACKED');

      const auditEntries = await prisma.auditLog.findMany({ where: { storeId, entityId: order.id, action: 'OrderFulfilled' } });
      expect(auditEntries.length).toBeGreaterThan(0);
    });

    it('rejects fulfilling an order that is not currently PROCESSING', async () => {
      const { token } = await createCustomer(`status.fulfillwrong.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`StatusFulfillWrong ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(token, productId);

      const res = await api().post(`/api/v1/admin/orders/${orderNumber}/fulfill`).set('Authorization', auth(adminToken)).send({});
      expect(res.status).toBe(409);
    });

    it('rejects fulfilling the same order twice (idempotent - Race 2, exactly-once consumption)', async () => {
      const { token } = await createCustomer(`status.fulfilltwice.${runId}@example.com`, 'Secret123!');
      const { productId, inventoryItemId } = await createProduct(`StatusFulfillTwice ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(token, productId, 3);
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' });

      const first = await api().post(`/api/v1/admin/orders/${orderNumber}/fulfill`).set('Authorization', auth(adminToken)).send({});
      expect(first.status).toBe(201);
      const second = await api().post(`/api/v1/admin/orders/${orderNumber}/fulfill`).set('Authorization', auth(adminToken)).send({});
      expect(second.status).toBe(409);

      const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      const onHandAfterFirst = 10 - 3;
      expect(item.onHandQuantity).toBe(onHandAfterFirst); // NOT 10 - 6 - the second call consumed nothing.
    });

    it('fulfills a multi-item order atomically - every line consumed together', async () => {
      const { token } = await createCustomer(`status.multiitem.${runId}@example.com`, 'Secret123!');
      const { productId: productA, inventoryItemId: itemA } = await createProduct(`MultiFulfillA ${runId}`, '50.00', 10);
      const { productId: productB, inventoryItemId: itemB } = await createProduct(`MultiFulfillB ${runId}`, '30.00', 10);

      await addToCart(token, productA, 2);
      await addToCart(token, productB, 3);
      const checkout = await createCheckout(token);
      expect(checkout.status).toBe(201);
      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(paymentId, checkout.body.razorpayOrderId, 'captured');
      const signature = signPayment(checkout.body.razorpayOrderId, paymentId);
      const verify = await api()
        .post('/api/v1/payments/razorpay/verify')
        .set('Authorization', auth(token))
        .send({ orderNumber: checkout.body.orderNumber, razorpayOrderId: checkout.body.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: signature });
      expect(verify.status).toBe(201);

      await api().patch(`/api/v1/admin/orders/${checkout.body.orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' });
      const fulfilled = await api().post(`/api/v1/admin/orders/${checkout.body.orderNumber}/fulfill`).set('Authorization', auth(adminToken)).send({});
      expect(fulfilled.status).toBe(201);

      const invA = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemA } });
      const invB = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemB } });
      expect(invA.onHandQuantity).toBe(8);
      expect(invB.onHandQuantity).toBe(7);
    });

    it('Race 1: two concurrent admin requests to start processing the SAME order - exactly one succeeds', async () => {
      const { token } = await createCustomer(`status.race1.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`StatusRace1 ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(token, productId);

      const [a, b] = await Promise.all([
        api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' }),
        api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);
    });

    it('Race 3: fulfilling and cancelling the same PROCESSING order concurrently resolves deterministically - never both succeed', async () => {
      const { token } = await createCustomer(`status.race3.${runId}@example.com`, 'Secret123!');
      const { productId, inventoryItemId } = await createProduct(`StatusRace3 ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(token, productId, 2);
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' });

      const [fulfillRes, cancelRes] = await Promise.all([
        api().post(`/api/v1/admin/orders/${orderNumber}/fulfill`).set('Authorization', auth(adminToken)).send({}),
        api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'CANCELLED' }),
      ]);
      // Exactly one of the two operations wins (whichever gets there first -
      // not deterministic which) - fulfill succeeds with 201 (POST), cancel
      // succeeds with 200 (PATCH); the loser always sees 409.
      const outcomes = [fulfillRes.status, cancelRes.status];
      expect(outcomes.filter((s) => s === 409)).toHaveLength(1);
      expect(outcomes.filter((s) => s === 200 || s === 201)).toHaveLength(1);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber } });
      expect(['PACKED', 'CANCELLED']).toContain(order.status);

      // Whichever won, inventory must be internally consistent - no double
      // effect (both a physical consumption AND a release) ever applied.
      const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(item.availableQuantity).toBeGreaterThanOrEqual(0);
      expect(item.reservedQuantity).toBeGreaterThanOrEqual(0);
      expect(item.availableQuantity).toBe(item.onHandQuantity - item.reservedQuantity);
      if (order.status === 'PACKED') {
        expect(item.onHandQuantity).toBe(8); // fulfilled: physically consumed.
      } else {
        expect(item.onHandQuantity).toBe(10); // cancelled: never physically consumed, held stock released back.
        expect(item.availableQuantity).toBe(10);
      }
    });
  });

  // -------------------------------------------------------------------
  // Cancellation - admin and customer
  // -------------------------------------------------------------------
  describe('Cancellation', () => {
    it('admin cancelling a CONFIRMED order releases its COMMITTED reservation back to available stock, without touching the captured payment', async () => {
      const { token } = await createCustomer(`cancel.confirmed.${runId}@example.com`, 'Secret123!');
      const { productId, inventoryItemId } = await createProduct(`CancelConfirmed ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(token, productId, 4);

      const before = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(before.availableQuantity).toBe(6);

      const res = await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'CANCELLED', reason: 'Customer request' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');

      const after = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(after.availableQuantity).toBe(10);
      expect(after.reservedQuantity).toBe(0);
      expect(after.committedQuantity).toBe(0);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber }, include: { payments: true } });
      expect(order.payments[0].status).toBe('CAPTURED'); // never silently marked FAILED because the order was cancelled.
    });

    it('cannot cancel a PACKED order', async () => {
      const { token } = await createCustomer(`cancel.packed.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`CancelPacked ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(token, productId);
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' });
      await api().post(`/api/v1/admin/orders/${orderNumber}/fulfill`).set('Authorization', auth(adminToken)).send({});

      const res = await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'CANCELLED' });
      expect(res.status).toBe(409);
    });

    it('a customer can cancel their own CONFIRMED order', async () => {
      const { token } = await createCustomer(`cancel.customer.${runId}@example.com`, 'Secret123!');
      const { productId, inventoryItemId } = await createProduct(`CancelCustomer ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(token, productId, 2);

      const res = await api().post(`/api/v1/orders/${orderNumber}/cancel`).set('Authorization', auth(token)).send({ reason: 'Changed my mind' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('CANCELLED');

      const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(item.availableQuantity).toBe(10);
    });

    it("a customer cannot cancel another customer's order (safe 404)", async () => {
      const { token: owner } = await createCustomer(`cancel.ownerC.${runId}@example.com`, 'Secret123!');
      const { token: intruder } = await createCustomer(`cancel.intruderC.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`CancelIntruder ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(owner, productId);

      const res = await api().post(`/api/v1/orders/${orderNumber}/cancel`).set('Authorization', auth(intruder)).send({});
      expect(res.status).toBe(404);
    });

    it('a customer cannot cancel once an admin has moved the order to PROCESSING', async () => {
      const { token } = await createCustomer(`cancel.processing.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`CancelProcessing ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(token, productId);
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' });

      const res = await api().post(`/api/v1/orders/${orderNumber}/cancel`).set('Authorization', auth(token)).send({});
      expect(res.status).toBe(409);
    });
  });

  // -------------------------------------------------------------------
  // Admin order list/detail + security
  // -------------------------------------------------------------------
  describe('Admin order list and detail', () => {
    it('lists orders with pagination and filters by status', async () => {
      const { token } = await createCustomer(`admin.list.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`AdminList ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(token, productId);

      const res = await api().get('/api/v1/admin/orders').set('Authorization', auth(adminToken)).query({ status: 'CONFIRMED', search: orderNumber });
      expect(res.status).toBe(200);
      expect(res.body.items.some((o: { orderNumber: string }) => o.orderNumber === orderNumber)).toBe(true);
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
    });

    it('returns the full admin detail including payment provider ids, never a secret', async () => {
      const { token } = await createCustomer(`admin.detail.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`AdminDetail ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(token, productId);

      const res = await api().get(`/api/v1/admin/orders/${orderNumber}`).set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.payments[0].providerOrderId).toBeDefined();
      expect(res.body.payments[0].providerPaymentId).toBeDefined();
      expect(res.body).not.toHaveProperty('razorpayKeySecret');
      expect(JSON.stringify(res.body)).not.toMatch(/webhookSecret|keySecret/i);
      expect(res.body.confirmedAt).not.toBeNull();
    });

    it("rejects an admin from a DIFFERENT store viewing this store's order (tenant isolation, safe 404)", async () => {
      const { token } = await createCustomer(`admin.tenant.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`AdminTenant ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(token, productId);

      const storeB = await prisma.store.create({ data: { slug: `store-b-order-${runId}`, name: 'Store B', isActive: true } });
      const { token: storeBToken } = await createLimitedAdmin(storeB.id, ['order.read'], `storeb.order.${runId}@example.com`);

      const res = await api().get(`/api/v1/admin/orders/${orderNumber}`).set('Authorization', auth(storeBToken));
      expect(res.status).toBe(404);
    });

    it('rejects an admin without order.status from changing an order status', async () => {
      const { token } = await createCustomer(`admin.nopermission.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`AdminNoPermission ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(token, productId);

      const { token: readOnlyToken } = await createLimitedAdmin(storeId, ['order.read'], `readonly.order.${runId}@example.com`);
      const res = await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(readOnlyToken)).send({ status: 'PROCESSING' });
      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // Customer-facing order detail - status timeline
  // -------------------------------------------------------------------
  describe('Customer order detail timeline', () => {
    it('shows only statuses actually reached, in order, with confirmedAt from the captured payment', async () => {
      const { token } = await createCustomer(`timeline.customer.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`Timeline ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(token, productId);
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' });

      const res = await api().get(`/api/v1/orders/${orderNumber}`).set('Authorization', auth(token));
      expect(res.status).toBe(200);
      expect(res.body.confirmedAt).not.toBeNull();
      expect(res.body.statusTimeline.map((e: { status: string }) => e.status)).toEqual(['PROCESSING']);
      expect(res.body).not.toHaveProperty('payments');
      expect(res.body).not.toHaveProperty('orderId');
    });
  });

  // -------------------------------------------------------------------
  // Database invariants after the full test suite's activity
  // -------------------------------------------------------------------
  describe('Database invariants', () => {
    it('every inventory item touched by this suite remains internally consistent', async () => {
      const items = await prisma.inventoryItem.findMany({ where: { storeId, warehouseId } });
      for (const item of items) {
        expect(item.onHandQuantity).toBeGreaterThanOrEqual(0);
        expect(item.reservedQuantity).toBeGreaterThanOrEqual(0);
        expect(item.availableQuantity).toBeGreaterThanOrEqual(0);
        expect(item.availableQuantity).toBe(item.onHandQuantity - item.reservedQuantity);
      }
    });

    it('no order has more than one fulfillment (fulfilledAt is set at most once, PACKED/SHIPPED/DELIVERED orders all have it, earlier ones do not)', async () => {
      const fulfillableOrders = await prisma.order.findMany({ where: { storeId, status: { in: ['PACKED', 'SHIPPED', 'DELIVERED'] } } });
      for (const order of fulfillableOrders) {
        expect(order.fulfilledAt).not.toBeNull();
      }
      const unfulfilledStatusOrders = await prisma.order.findMany({ where: { storeId, status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'CANCELLED'] } } });
      for (const order of unfulfilledStatusOrders) {
        expect(order.fulfilledAt).toBeNull();
      }
    });

    it('every CONFIRMED-or-later order has a CAPTURED payment', async () => {
      const orders = await prisma.order.findMany({
        where: { storeId, status: { in: ['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED'] } },
        include: { payments: true },
      });
      for (const order of orders) {
        expect(order.payments.some((p) => p.status === 'CAPTURED')).toBe(true);
      }
    });

    it(
      'fulfilledAt != NULL implies PACKED/SHIPPED/DELIVERED, and every line was consumed exactly once (proven via the SALE ledger, tagged by orderNumber)',
      async () => {
        const fulfilledOrders = await prisma.order.findMany({ where: { storeId, fulfilledAt: { not: null } }, include: { items: true } });
        expect(fulfilledOrders.length).toBeGreaterThan(0);

        for (const order of fulfilledOrders) {
          expect(['PACKED', 'SHIPPED', 'DELIVERED']).toContain(order.status);

          for (const item of order.items) {
            const latest = await prisma.stockReservation.findFirst({ where: { orderItemId: item.id }, orderBy: { createdAt: 'desc' } });
            // Fulfillment moves COMMITTED -> RELEASED (physically consumed) -
            // a fulfilled order's line reservation is never still ACTIVE or
            // COMMITTED.
            expect(latest?.status).toBe('RELEASED');
          }

          // Exactly-once physical consumption: one SALE ledger entry per
          // order line, no more, no fewer - reference is the reservation's
          // own reference, which is always this order's orderNumber (set at
          // reserve()-time by CheckoutService/PaymentService.retryPayment).
          const saleEntries = await prisma.inventoryTransaction.count({ where: { type: 'SALE', reference: order.orderNumber } });
          expect(saleEntries).toBe(order.items.length);
        }
      },
      // This scans EVERY fulfilled order this store has EVER had across the
      // whole shared, persistent dev database (an N+1 query per order/item),
      // so its real running time grows with accumulated test history, not
      // with anything this phase changed - it already crossed Jest's 5000ms
      // default once (raised to 20000ms), then 20000ms again (raised to
      // 60000ms, measured ~23s in isolation at the time), then 60000ms again
      // (raised to 120000ms by Phase 13, measured ~56s in isolation at the
      // time). By Phase 15, after many further full-regression runs across
      // Phases 14/14-R1/15 on this same persistent dev database (now tens of
      // thousands of orders), it measured ~142s in isolation - exceeding
      // even that 120000ms ceiling. Raised again with substantial headroom
      // (300000ms) rather than another narrow increment, since the growth
      // trend itself is expected to continue for as long as this project
      // reuses the same accumulating dev database - no assertion changed
      // any of these times. This is a test-ENVIRONMENT characteristic of a
      // shared, ever-growing dev database, not a production code defect: a
      // real production database starts empty and a fresh deployment would
      // never encounter this specific scaling behavior.
      300000,
    );
  });

  // -------------------------------------------------------------------
  // Micro-correction - cancellation semantics, forced rollback, concurrency
  // -------------------------------------------------------------------
  describe('Micro-correction', () => {
    it('CONFIRMED + CAPTURED cancellation: releases COMMITTED reservation, restores availability, leaves Payment CAPTURED, creates no SALE entry, never implies a refund', async () => {
      const { token } = await createCustomer(`micro.confirmedcancel.${runId}@example.com`, 'Secret123!');
      const { productId, inventoryItemId } = await createProduct(`MicroConfirmedCancel ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(token, productId, 3);

      const beforeItem = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(beforeItem.availableQuantity).toBe(7);
      expect(beforeItem.committedQuantity).toBe(3);
      const saleEntriesBefore = await prisma.inventoryTransaction.count({ where: { inventoryItemId, type: 'SALE' } });

      const res = await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'CANCELLED', reason: 'Merchant cancellation before fulfillment' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
      // The response must never claim or imply a refund happened - no such
      // field exists anywhere in this codebase (no refund feature - Phase
      // 6 scope boundary).
      expect(JSON.stringify(res.body).toLowerCase()).not.toContain('refund');

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber }, include: { payments: true } });
      expect(order.status).toBe('CANCELLED');
      expect(order.fulfilledAt).toBeNull();
      expect(order.payments[0].status).toBe('CAPTURED'); // never flipped to FAILED/CANCELLED merely because the order was cancelled.

      const afterItem = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(afterItem.availableQuantity).toBe(10);
      expect(afterItem.reservedQuantity).toBe(0);
      expect(afterItem.committedQuantity).toBe(0);
      expect(afterItem.onHandQuantity).toBe(10); // never physically consumed - no SALE ever happened.

      const saleEntriesAfter = await prisma.inventoryTransaction.count({ where: { inventoryItemId, type: 'SALE' } });
      expect(saleEntriesAfter).toBe(saleEntriesBefore); // still zero - cancellation is not a fulfillment.

      const reservation = await prisma.stockReservation.findFirstOrThrow({ where: { orderId: order.id } });
      expect(reservation.status).toBe('RELEASED');

      const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id, newStatus: 'CANCELLED' } });
      expect(history).toHaveLength(1);
      expect(history[0].previousStatus).toBe('CONFIRMED');
      expect(history[0].source).toBe('ADMIN');
    });

    it('PENDING_PAYMENT cancellation releases the ACTIVE reservation, and a repeated cancellation is safely rejected with no double release or duplicate history', async () => {
      const { token } = await createCustomer(`micro.pendingcancel.${runId}@example.com`, 'Secret123!');
      const { productId, inventoryItemId } = await createProduct(`MicroPendingCancel ${runId}`, '100.00', 10);
      await addToCart(token, productId, 4);
      const checkout = await createCheckout(token);
      expect(checkout.status).toBe(201);
      const orderNumber = checkout.body.orderNumber;

      const beforeItem = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(beforeItem.availableQuantity).toBe(6);
      expect(beforeItem.reservedQuantity).toBe(4);

      const first = await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'CANCELLED' });
      expect(first.status).toBe(200);
      expect(first.body.status).toBe('CANCELLED');

      const afterFirst = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(afterFirst.availableQuantity).toBe(10); // fully restored.
      expect(afterFirst.reservedQuantity).toBe(0);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber }, include: { payments: true } });
      const reservation = await prisma.stockReservation.findFirstOrThrow({ where: { orderId: order.id } });
      expect(reservation.status).toBe('RELEASED');
      // The payment attempt never completed - it must remain in a
      // semantically correct "still open, never captured" state, never
      // silently marked CAPTURED/FAILED by the cancellation itself.
      expect(['CREATED', 'PENDING']).toContain(order.payments[0].status);

      const second = await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'CANCELLED' });
      expect(second.status).toBe(409); // safely rejected - CANCELLED is terminal, no further transition allowed.

      const afterSecond = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(afterSecond.availableQuantity).toBe(10); // unchanged by the rejected second attempt - no double-credit.
      expect(afterSecond.reservedQuantity).toBe(0);

      const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id, newStatus: 'CANCELLED' } });
      expect(history).toHaveLength(1); // exactly one history record - the rejected second call created none.
      expect(history[0].previousStatus).toBe('PENDING_PAYMENT');
    });

    it('Race: two simultaneous cancellation requests for the same order resolve to exactly one real transition - no double release, no duplicate history', async () => {
      const { token } = await createCustomer(`micro.doublecancel.${runId}@example.com`, 'Secret123!');
      const { productId, inventoryItemId } = await createProduct(`MicroDoubleCancel ${runId}`, '100.00', 10);
      const orderNumber = await checkoutAndConfirm(token, productId, 5);

      const [a, b] = await Promise.all([
        api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'CANCELLED' }),
        api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'CANCELLED' }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);

      const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(item.availableQuantity).toBe(10); // restored exactly once, never double-credited.
      expect(item.reservedQuantity).toBe(0);
      expect(item.committedQuantity).toBe(0);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber } });
      const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id, newStatus: 'CANCELLED' } });
      expect(history).toHaveLength(1);
    });

    it('a deliberately forced single-line failure during multi-item fulfillment rolls back the ENTIRE transaction - no partial consumption, no partial SALE entries, order stays PROCESSING', async () => {
      const { token } = await createCustomer(`micro.rollback.${runId}@example.com`, 'Secret123!');
      const { productId: productA, inventoryItemId: itemA } = await createProduct(`MicroRollbackA ${runId}`, '10.00', 10);
      const { productId: productB, inventoryItemId: itemB } = await createProduct(`MicroRollbackB ${runId}`, '10.00', 10);
      const { productId: productC, inventoryItemId: itemC } = await createProduct(`MicroRollbackC ${runId}`, '10.00', 10);

      await addToCart(token, productA, 2);
      await addToCart(token, productB, 1);
      await addToCart(token, productC, 3);
      const checkout = await createCheckout(token);
      expect(checkout.status).toBe(201);

      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(paymentId, checkout.body.razorpayOrderId, 'captured');
      const signature = signPayment(checkout.body.razorpayOrderId, paymentId);
      const verify = await api()
        .post('/api/v1/payments/razorpay/verify')
        .set('Authorization', auth(token))
        .send({ orderNumber: checkout.body.orderNumber, razorpayOrderId: checkout.body.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: signature });
      expect(verify.status).toBe(201);
      const orderNumber = checkout.body.orderNumber;

      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' });

      // Deliberately force ONE inventory operation to fail: corrupt line
      // C's reservation so it is no longer COMMITTED at fulfillment time -
      // simulating a real fault (e.g. an external interference or a bug
      // elsewhere) without faking anything inside the fulfillment code path
      // itself. Inventory bookkeeping is manually kept consistent with this
      // injected fault so the SETUP itself isn't the thing under test.
      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber } });
      const reservationC = await prisma.stockReservation.findFirstOrThrow({ where: { orderId: order.id, inventoryItemId: itemC } });
      await prisma.stockReservation.update({ where: { id: reservationC.id }, data: { status: 'RELEASED', releasedAt: new Date() } });
      await prisma.inventoryItem.update({
        where: { id: itemC },
        data: { reservedQuantity: { decrement: 3 }, committedQuantity: { decrement: 3 }, availableQuantity: { increment: 3 } },
      });

      const beforeA = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemA } });
      const beforeB = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemB } });
      const saleCountBefore = await prisma.inventoryTransaction.count({ where: { type: 'SALE' } });

      const fulfillRes = await api().post(`/api/v1/admin/orders/${orderNumber}/fulfill`).set('Authorization', auth(adminToken)).send({});
      expect(fulfillRes.status).toBe(409);

      const afterA = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemA } });
      const afterB = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemB } });
      expect(afterA.onHandQuantity).toBe(beforeA.onHandQuantity);
      expect(afterA.reservedQuantity).toBe(beforeA.reservedQuantity);
      expect(afterA.committedQuantity).toBe(beforeA.committedQuantity);
      expect(afterB.onHandQuantity).toBe(beforeB.onHandQuantity);
      expect(afterB.reservedQuantity).toBe(beforeB.reservedQuantity);
      expect(afterB.committedQuantity).toBe(beforeB.committedQuantity);

      const saleCountAfter = await prisma.inventoryTransaction.count({ where: { type: 'SALE' } });
      expect(saleCountAfter).toBe(saleCountBefore); // no SALE entries created for A or B either - fully atomic.

      const orderAfter = await prisma.order.findUniqueOrThrow({ where: { orderNumber } });
      expect(orderAfter.status).toBe('PROCESSING');
      expect(orderAfter.fulfilledAt).toBeNull();

      const reservationA = await prisma.stockReservation.findFirstOrThrow({ where: { orderId: order.id, inventoryItemId: itemA } });
      const reservationB = await prisma.stockReservation.findFirstOrThrow({ where: { orderId: order.id, inventoryItemId: itemB } });
      expect(reservationA.status).toBe('COMMITTED'); // untouched - rolled back.
      expect(reservationB.status).toBe('COMMITTED');
    });
  });
});
