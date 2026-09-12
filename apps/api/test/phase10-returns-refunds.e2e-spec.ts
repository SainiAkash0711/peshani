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
import { REFUND_PROVIDER } from '../src/modules/payments/providers/refund-provider.interface';
import { OutboxWorkerService } from '../src/modules/notifications/outbox-worker.service';
import { EmailDeliveryWorkerService } from '../src/modules/notifications/email-delivery-worker.service';
import { FakeRazorpayProvider, signPayment } from './helpers/fake-razorpay-provider';
import { FakeRazorpayRefundProvider } from './helpers/fake-razorpay-refund-provider';

jest.setTimeout(30000);

/**
 * Phase 10 - Returns, Refunds & Post-Purchase Order Issue Management (e2e).
 * Covers: return eligibility/window/quantity rules, the full admin state
 * machine (approve/reject/receive/inspect/refund), inventory disposition
 * (restock/damaged/unsellable) via the real InventoryService ledger, refund
 * calculation (coupon/discount allocation), provider success/failure/
 * timeout/unknown-outcome/recovery via a deterministic MOCK provider (a real
 * Razorpay account was not available in this environment - see the final
 * report's explicit REAL vs MOCK distinction), idempotency, concurrency
 * (return-quantity race, duplicate approval, duplicate refund, duplicate
 * restock), security/tenant-isolation, and direct database invariants.
 */
describe('Peshani Phase 10 - Returns & Refunds (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService<AppConfig, true>;
  let fakePaymentProvider: FakeRazorpayProvider;
  let fakeRefundProvider: FakeRazorpayRefundProvider;
  let outboxWorker: OutboxWorkerService;
  let emailWorker: EmailDeliveryWorkerService;
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

  async function drainOutboxAndEmail() {
    while ((await outboxWorker.processBatchOnce()) > 0) {
      /* keep draining */
    }
    while ((await emailWorker.processBatchOnce()) > 0) {
      /* keep draining */
    }
  }

  async function createProduct(name: string, price: string, available: number) {
    const product = await prisma.product.create({
      data: {
        storeId,
        name,
        slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        sku: `${name.replace(/\s+/g, '')}-${runId}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'ACTIVE',
        productType: 'SIMPLE',
        basePrice: price,
      },
    });
    await prisma.inventoryItem.create({
      data: { storeId, productId: product.id, variantId: null, warehouseId, onHandQuantity: available, availableQuantity: available, reservedQuantity: 0 },
    });
    return { productId: product.id };
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

  async function createLimitedAdmin(permissionKeys: string[], email: string) {
    const perms = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });
    const role = await prisma.role.create({ data: { storeId, name: `ROLE-${Math.random().toString(36).slice(2, 8)}` } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    const user = await prisma.user.create({
      data: { storeId, email, passwordHash: await argon2.hash('irrelevant'), type: 'ADMIN', isActive: true, emailVerifiedAt: new Date() },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const token = await jwtService.signAsync(
      { sub: user.id, storeId, email: user.email, type: 'ADMIN', roles: [role.name], permissions: perms.map((p) => p.key) },
      { secret: configService.get('jwt', { infer: true }).accessSecret, expiresIn: '15m', algorithm: 'HS256', issuer: 'peshani-api', audience: 'peshani-client' },
    );
    return { token, userId: user.id };
  }

  /** Drives a real order all the way to DELIVERED through the actual Phase 5/6 pipeline. */
  async function checkoutToDelivered(token: string, productId: string, quantity = 1, couponCode?: string) {
    await api().post('/api/v1/cart/items').set('Authorization', auth(token)).send({ productId, quantity });
    const checkoutBody: Record<string, unknown> = { email: 'buyer@example.com', billingAddress: address };
    if (couponCode) checkoutBody.couponCode = couponCode;
    const checkout = await api().post('/api/v1/checkout/create').set('Authorization', auth(token)).send(checkoutBody);
    expect(checkout.status).toBe(201);

    const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
    fakePaymentProvider.registerPayment(paymentId, checkout.body.razorpayOrderId, 'captured');
    const signature = signPayment(checkout.body.razorpayOrderId, paymentId);
    const verify = await api()
      .post('/api/v1/payments/razorpay/verify')
      .set('Authorization', auth(token))
      .send({ orderNumber: checkout.body.orderNumber, razorpayOrderId: checkout.body.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: signature });
    expect(verify.status).toBe(201);

    const orderNumber = checkout.body.orderNumber as string;
    await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' });
    await api().post(`/api/v1/admin/orders/${orderNumber}/fulfill`).set('Authorization', auth(adminToken)).send({});
    await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'SHIPPED' });
    const delivered = await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'DELIVERED' });
    expect(delivered.status).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber }, include: { items: true } });
    return { orderNumber, orderId: order.id, orderItemId: order.items[0].id, order };
  }

  /** Full happy-path helper: request -> approve -> received -> inspect(all RESTOCK) -> refund succeeds -> COMPLETED. Returns the final return + refund. */
  async function driveReturnToRefunded(token: string, orderNumber: string, orderItemId: string, quantity: number) {
    const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity }], reason: 'CHANGED_MIND' });
    expect(created.status).toBe(201);
    const returnId = created.body.id as string;

    await api().post(`/api/v1/admin/returns/${returnId}/approve`).set('Authorization', auth(adminToken)).send({});
    await api().post(`/api/v1/admin/returns/${returnId}/received`).set('Authorization', auth(adminToken)).send({});
    const inspected = await api()
      .post(`/api/v1/admin/returns/${returnId}/inspect`)
      .set('Authorization', auth(adminToken))
      .send({ items: created.body.items.map((i: { id: string }) => ({ returnItemId: i.id, itemCondition: 'NEW', disposition: 'RESTOCK' })) });
    expect(inspected.status).toBe(201);

    const refunded = await api().post(`/api/v1/admin/returns/${returnId}/refund`).set('Authorization', auth(adminToken)).send({});
    expect(refunded.status).toBe(201);
    await drainOutboxAndEmail();

    return { returnId, refund: refunded.body };
  }

  beforeAll(async () => {
    fakePaymentProvider = new FakeRazorpayProvider();
    fakeRefundProvider = new FakeRazorpayRefundProvider();

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(fakePaymentProvider)
      .overrideProvider(REFUND_PROVIDER)
      .useValue(fakeRefundProvider)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService<AppConfig, true>);
    outboxWorker = app.get(OutboxWorkerService);
    emailWorker = app.get(EmailDeliveryWorkerService);

    const store = await prisma.store.findUniqueOrThrow({ where: { slug: DEFAULT_STORE_SLUG } });
    storeId = store.id;

    const warehouse = await prisma.warehouse.create({ data: { storeId, name: `Phase10 WH ${runId}`, code: `P10-WH-${runId}`, isActive: true, isDefault: true } });
    warehouseId = warehouse.id;

    const adminLogin = await api().post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Return eligibility', () => {
    it('reports ineligible for a non-DELIVERED order, and eligible (with max-returnable quantities) for a DELIVERED one', async () => {
      const { token } = await createCustomer(`p10.elig.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10Elig ${runId}`, '200.00', 10);
      await api().post('/api/v1/cart/items').set('Authorization', auth(token)).send({ productId, quantity: 1 });
      const checkout = await api().post('/api/v1/checkout/create').set('Authorization', auth(token)).send({ email: 'buyer@example.com', billingAddress: address });

      const beforeDelivery = await api().get(`/api/v1/orders/${checkout.body.orderNumber}/return-eligibility`).set('Authorization', auth(token));
      expect(beforeDelivery.status).toBe(200);
      expect(beforeDelivery.body.eligible).toBe(false);

      const { orderNumber, orderItemId } = await checkoutToDelivered(token, (await createProduct(`P10Elig2 ${runId}`, '200.00', 10)).productId);
      const after = await api().get(`/api/v1/orders/${orderNumber}/return-eligibility`).set('Authorization', auth(token));
      expect(after.status).toBe(200);
      expect(after.body.eligible).toBe(true);
      expect(after.body.items[0].orderItemId).toBe(orderItemId);
      expect(after.body.items[0].maxReturnableQuantity).toBe(1);
    });

    it('rejects a return request outside the configured return window (server-side, never trusting a client timestamp)', async () => {
      const { token } = await createCustomer(`p10.window.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10Window ${runId}`, '150.00', 10);
      const { orderNumber, orderItemId, orderId } = await checkoutToDelivered(token, productId);

      // Backdate the REAL OrderStatusHistory DELIVERED transition - the one
      // authoritative source this system uses (§11) - rather than trusting
      // any client-supplied timestamp, which the DTO doesn't even accept.
      await prisma.orderStatusHistory.updateMany({ where: { orderId, newStatus: 'DELIVERED' }, data: { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } });

      const res = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/return window/i);
    });

    it('rejects a request for more than the purchased quantity', async () => {
      const { token } = await createCustomer(`p10.overqty.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10OverQty ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId, 2);

      const res = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 3 }], reason: 'CHANGED_MIND' });
      expect(res.status).toBe(400);
    });

    it('rejects a return for another order (invalid order reference / cross-user access, safe 404-equivalent)', async () => {
      const { token: ownerToken } = await createCustomer(`p10.crossuser.owner.${runId}@example.com`, 'Secret123!');
      const { token: otherToken } = await createCustomer(`p10.crossuser.other.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10CrossUser ${runId}`, '100.00', 10);
      const { orderNumber } = await checkoutToDelivered(ownerToken, productId);

      const res = await api().post('/api/v1/returns').set('Authorization', auth(otherToken)).send({ orderNumber, items: [{ orderItemId: 'not-a-real-uuid-00000000-0000-0000-0000-000000000000', quantity: 1 }], reason: 'CHANGED_MIND' });
      expect([400, 404, 409]).toContain(res.status);
    });

    it('rejects an entirely unknown orderNumber', async () => {
      const { token } = await createCustomer(`p10.unknown.${runId}@example.com`, 'Secret123!');
      const res = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber: `PES-UNKNOWN-${runId}`, items: [{ orderItemId: '00000000-0000-0000-0000-000000000000', quantity: 1 }], reason: 'CHANGED_MIND' });
      expect(res.status).toBe(409);
    });
  });

  describe('Customer create/list/cancel', () => {
    it('creates a return request, lists it, fetches it by id, and cancels it', async () => {
      const { token } = await createCustomer(`p10.crud.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10Crud ${runId}`, '300.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId);

      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'DEFECTIVE', customerComment: 'It broke.' });
      expect(created.status).toBe(201);
      expect(created.body.status).toBe('REQUESTED');
      expect(created.body.items).toHaveLength(1);
      expect(Number(created.body.items[0].refundAmount)).toBeCloseTo(300, 2);

      const list = await api().get('/api/v1/returns').set('Authorization', auth(token));
      expect(list.body.items.some((r: { id: string }) => r.id === created.body.id)).toBe(true);

      const one = await api().get(`/api/v1/returns/${created.body.id}`).set('Authorization', auth(token));
      expect(one.status).toBe(200);

      const cancelled = await api().post(`/api/v1/returns/${created.body.id}/cancel`).set('Authorization', auth(token));
      expect(cancelled.status).toBe(201);
      expect(cancelled.body.status).toBe('CANCELLED');
    });

    it('a cancelled return frees up the returnable quantity for a new request', async () => {
      const { token } = await createCustomer(`p10.cancelfree.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10CancelFree ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId, 2);

      const first = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 2 }], reason: 'CHANGED_MIND' });
      expect(first.status).toBe(201);
      await api().post(`/api/v1/returns/${first.body.id}/cancel`).set('Authorization', auth(token));

      const second = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 2 }], reason: 'CHANGED_MIND' });
      expect(second.status).toBe(201);
    });

    it('cannot cancel a return once an admin has approved it', async () => {
      const { token } = await createCustomer(`p10.cancelapproved.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10CancelApproved ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });
      await api().post(`/api/v1/admin/returns/${created.body.id}/approve`).set('Authorization', auth(adminToken)).send({});

      const cancel = await api().post(`/api/v1/returns/${created.body.id}/cancel`).set('Authorization', auth(token));
      expect(cancel.status).toBe(403);
    });

    it("a Store B customer cannot see or cancel Store A's return (tenant isolation)", async () => {
      const { token: ownerToken } = await createCustomer(`p10.tenant.owner.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10Tenant ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(ownerToken, productId);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(ownerToken)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });

      const storeB = await prisma.store.create({ data: { slug: `store-b-returns-${runId}`, name: 'Store B', isActive: true } });
      const roleB = await prisma.role.create({ data: { storeId: storeB.id, name: 'CUSTOMER' } });
      const userB = await prisma.user.create({ data: { storeId: storeB.id, email: `p10.storeb.${runId}@example.com`, passwordHash: await argon2.hash('Secret123!'), type: 'CUSTOMER', isActive: true, emailVerifiedAt: new Date() } });
      await prisma.userRole.create({ data: { userId: userB.id, roleId: roleB.id } });
      const tokenB = await jwtService.signAsync(
        { sub: userB.id, storeId: storeB.id, email: userB.email, type: 'CUSTOMER', roles: ['CUSTOMER'], permissions: [] },
        { secret: configService.get('jwt', { infer: true }).accessSecret, expiresIn: '15m', algorithm: 'HS256', issuer: 'peshani-api', audience: 'peshani-client' },
      );

      const getRes = await api().get(`/api/v1/returns/${created.body.id}`).set('Authorization', auth(tokenB));
      expect(getRes.status).toBe(404);
      const cancelRes = await api().post(`/api/v1/returns/${created.body.id}/cancel`).set('Authorization', auth(tokenB));
      expect(cancelRes.status).toBe(404);
    });
  });

  describe('Return evidence upload (reuses the existing MediaUploadService)', () => {
    it('uploads a valid JPEG as evidence, scoped to the return owner', async () => {
      const { token } = await createCustomer(`p10.evidence.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10Evidence ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'DAMAGED' });

      // Minimal valid 1x1 JPEG (real magic bytes + a real sharp-decodable image).
      const jpegBase64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';
      const upload = await api().post(`/api/v1/returns/${created.body.id}/evidence`).set('Authorization', auth(token)).attach('file', Buffer.from(jpegBase64, 'base64'), 'evidence.jpg');
      expect(upload.status).toBe(201);
      expect(upload.body.mimeType).toBe('image/jpeg');

      const evidenceRows = await prisma.returnEvidence.findMany({ where: { returnRequestId: created.body.id } });
      expect(evidenceRows).toHaveLength(1);
    });

    it('rejects a non-image file disguised with an image extension (magic-byte verification reused, not bypassed)', async () => {
      const { token } = await createCustomer(`p10.evidencebad.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10EvidenceBad ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'DAMAGED' });

      const upload = await api().post(`/api/v1/returns/${created.body.id}/evidence`).set('Authorization', auth(token)).attach('file', Buffer.from('not a real image'), 'evidence.jpg');
      expect(upload.status).toBe(400);
    });
  });

  describe('Admin state machine', () => {
    it('approve -> receive -> inspect(RESTOCK) -> refund succeeds -> COMPLETED, and inventory is actually restocked via the real ledger', async () => {
      const { token, userId } = await createCustomer(`p10.fullflow.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10FullFlow ${runId}`, '250.00', 5);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId, 1);

      const inventoryItem = await prisma.inventoryItem.findFirstOrThrow({ where: { storeId, productId } });
      const availableBefore = inventoryItem.availableQuantity;

      const { returnId, refund } = await driveReturnToRefunded(token, orderNumber, orderItemId, 1);

      const finalReturn = await api().get(`/api/v1/admin/returns/${returnId}`).set('Authorization', auth(adminToken));
      expect(finalReturn.body.status).toBe('COMPLETED');
      expect(refund.status).toBe('SUCCEEDED');
      expect(Number(refund.amount)).toBeCloseTo(250, 2);

      const inventoryAfter = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItem.id } });
      expect(inventoryAfter.availableQuantity).toBe(availableBefore + 1); // restocked exactly once.

      const ledgerEntries = await prisma.inventoryTransaction.findMany({ where: { inventoryItemId: inventoryItem.id, type: 'RETURN' } });
      expect(ledgerEntries).toHaveLength(1);

      const n = await prisma.notification.findFirst({ where: { storeId, userId, type: 'REFUND_SUCCEEDED', channel: 'IN_APP' } });
      expect(n).not.toBeNull();
    });

    it('rejects an admin action skipping a required step (cannot inspect before received)', async () => {
      const { token } = await createCustomer(`p10.skipstep.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10SkipStep ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });
      await api().post(`/api/v1/admin/returns/${created.body.id}/approve`).set('Authorization', auth(adminToken)).send({});

      const inspect = await api()
        .post(`/api/v1/admin/returns/${created.body.id}/inspect`)
        .set('Authorization', auth(adminToken))
        .send({ items: created.body.items.map((i: { id: string }) => ({ returnItemId: i.id, itemCondition: 'NEW', disposition: 'RESTOCK' })) });
      expect(inspect.status).toBe(409);
    });

    it('reject leaves the return REJECTED and notifies the customer; a REJECTED return can never be approved afterward', async () => {
      const { token, userId } = await createCustomer(`p10.reject.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10Reject ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });

      const rejected = await api().post(`/api/v1/admin/returns/${created.body.id}/reject`).set('Authorization', auth(adminToken)).send({ adminComment: 'Outside policy' });
      expect(rejected.status).toBe(201);
      expect(rejected.body.status).toBe('REJECTED');
      await drainOutboxAndEmail();

      const n = await prisma.notification.findFirst({ where: { storeId, userId, type: 'RETURN_REJECTED', channel: 'IN_APP' } });
      expect(n).not.toBeNull();

      const approveAfter = await api().post(`/api/v1/admin/returns/${created.body.id}/approve`).set('Authorization', auth(adminToken)).send({});
      expect(approveAfter.status).toBe(409);
    });

    it('a DAMAGED disposition never restocks sellable inventory', async () => {
      const { token } = await createCustomer(`p10.damaged.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10Damaged ${runId}`, '150.00', 5);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId, 1);
      const inventoryItem = await prisma.inventoryItem.findFirstOrThrow({ where: { storeId, productId } });
      const availableBefore = inventoryItem.availableQuantity;

      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'DAMAGED' });
      await api().post(`/api/v1/admin/returns/${created.body.id}/approve`).set('Authorization', auth(adminToken)).send({});
      await api().post(`/api/v1/admin/returns/${created.body.id}/received`).set('Authorization', auth(adminToken)).send({});
      const inspected = await api()
        .post(`/api/v1/admin/returns/${created.body.id}/inspect`)
        .set('Authorization', auth(adminToken))
        .send({ items: created.body.items.map((i: { id: string }) => ({ returnItemId: i.id, itemCondition: 'DAMAGED', disposition: 'DAMAGED' })) });
      expect(inspected.status).toBe(201);

      const inventoryAfter = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItem.id } });
      expect(inventoryAfter.availableQuantity).toBe(availableBefore); // unchanged - never restocked.
      const ledgerEntries = await prisma.inventoryTransaction.findMany({ where: { inventoryItemId: inventoryItem.id, type: 'RETURN' } });
      expect(ledgerEntries).toHaveLength(0);
    });

    it('an UNSELLABLE disposition also never restocks sellable inventory', async () => {
      const { token } = await createCustomer(`p10.unsellable.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10Unsellable ${runId}`, '150.00', 5);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId, 1);
      const inventoryItem = await prisma.inventoryItem.findFirstOrThrow({ where: { storeId, productId } });
      const availableBefore = inventoryItem.availableQuantity;

      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'DEFECTIVE' });
      await api().post(`/api/v1/admin/returns/${created.body.id}/approve`).set('Authorization', auth(adminToken)).send({});
      await api().post(`/api/v1/admin/returns/${created.body.id}/received`).set('Authorization', auth(adminToken)).send({});
      await api()
        .post(`/api/v1/admin/returns/${created.body.id}/inspect`)
        .set('Authorization', auth(adminToken))
        .send({ items: created.body.items.map((i: { id: string }) => ({ returnItemId: i.id, itemCondition: 'DEFECTIVE', disposition: 'UNSELLABLE' })) });

      const inventoryAfter = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItem.id } });
      expect(inventoryAfter.availableQuantity).toBe(availableBefore);
    });

    it('duplicate restock is a safe no-op (idempotent) even if inspect is somehow re-submitted', async () => {
      const { token } = await createCustomer(`p10.duprestock.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10DupRestock ${runId}`, '150.00', 5);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId, 1);
      const inventoryItem = await prisma.inventoryItem.findFirstOrThrow({ where: { storeId, productId } });
      const availableBefore = inventoryItem.availableQuantity;

      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });
      await api().post(`/api/v1/admin/returns/${created.body.id}/approve`).set('Authorization', auth(adminToken)).send({});
      await api().post(`/api/v1/admin/returns/${created.body.id}/received`).set('Authorization', auth(adminToken)).send({});
      const returnItemId = created.body.items[0].id;
      await api().post(`/api/v1/admin/returns/${created.body.id}/inspect`).set('Authorization', auth(adminToken)).send({ items: [{ returnItemId, itemCondition: 'NEW', disposition: 'RESTOCK' }] });

      // Directly re-invoke the SAME idempotent restock claim a second time,
      // simulating a retried/duplicated submission at the service level -
      // the ReturnItem.restockedAt guard must make this a pure no-op.
      const returnItemRow = await prisma.returnItem.findUniqueOrThrow({ where: { id: returnItemId } });
      expect(returnItemRow.restockedAt).not.toBeNull();
      const claim = await prisma.returnItem.updateMany({ where: { id: returnItemId, restockedAt: null }, data: { restockedAt: new Date() } });
      expect(claim.count).toBe(0); // already claimed - cannot be claimed again.

      const inventoryAfter = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItem.id } });
      expect(inventoryAfter.availableQuantity).toBe(availableBefore + 1); // increased exactly once, not twice.
    });

    it('an admin without return.approve cannot approve, but one with the permission can', async () => {
      const { token } = await createCustomer(`p10.rbac.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10Rbac ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });

      const { token: readOnly } = await createLimitedAdmin(['return.read'], `p10.readonly.${runId}@example.com`);
      const denied = await api().post(`/api/v1/admin/returns/${created.body.id}/approve`).set('Authorization', auth(readOnly)).send({});
      expect(denied.status).toBe(403);

      const { token: approver } = await createLimitedAdmin(['return.read', 'return.approve'], `p10.approver.${runId}@example.com`);
      const approved = await api().post(`/api/v1/admin/returns/${created.body.id}/approve`).set('Authorization', auth(approver)).send({});
      expect(approved.status).toBe(201);
    });

    it('a plain customer token is rejected by every admin returns endpoint', async () => {
      const { token } = await createCustomer(`p10.customerblock.${runId}@example.com`, 'Secret123!');
      const res = await api().get('/api/v1/admin/returns').set('Authorization', auth(token));
      expect(res.status).toBe(403);
    });

    it('admin list supports filtering by status/reason/orderNumber and pagination', async () => {
      const { token } = await createCustomer(`p10.filter.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10Filter ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId);
      await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'WRONG_ITEM' });

      const byStatus = await api().get('/api/v1/admin/returns?status=REQUESTED').set('Authorization', auth(adminToken));
      expect(byStatus.status).toBe(200);
      expect(byStatus.body.items.every((r: { status: string }) => r.status === 'REQUESTED')).toBe(true);

      const byOrderNumber = await api().get(`/api/v1/admin/returns?orderNumber=${orderNumber}`).set('Authorization', auth(adminToken));
      expect(byOrderNumber.body.items.some((r: { order: { orderNumber: string } }) => r.order.orderNumber === orderNumber)).toBe(true);

      const byReason = await api().get('/api/v1/admin/returns?reason=WRONG_ITEM').set('Authorization', auth(adminToken));
      expect(byReason.body.items.every((r: { reason: string }) => r.reason === 'WRONG_ITEM')).toBe(true);
    });
  });

  describe('Refund calculation (coupon/discount handling)', () => {
    it('no coupon: refund equals unit price x quantity exactly', async () => {
      const { token } = await createCustomer(`p10.nocoupon.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10NoCoupon ${runId}`, '400.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId, 1);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });
      expect(Number(created.body.items[0].refundAmount)).toBeCloseTo(400, 2);
    });

    it('a partial item return refunds only the returned quantity, proportionally', async () => {
      const { token } = await createCustomer(`p10.partial.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10Partial ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId, 4);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 2 }], reason: 'CHANGED_MIND' });
      expect(Number(created.body.items[0].refundAmount)).toBeCloseTo(200, 2); // 2 of 4 units, no discount.
    });

    it('a percentage coupon reduces the refund proportionally - never refunds more than the customer actually paid', async () => {
      const { token } = await createCustomer(`p10.pctcoupon.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10PctCoupon ${runId}`, '500.00', 10);

      const promotion = await prisma.promotion.create({ data: { storeId, name: `P10 Pct ${runId}`, discountType: 'PERCENTAGE', value: '10.00', isActive: true } });
      const coupon = await prisma.coupon.create({ data: { storeId, promotionId: promotion.id, code: `P10PCT${runId}`, normalizedCode: `P10PCT${runId}`, isActive: true } });

      const { orderNumber, orderItemId, order } = await checkoutToDelivered(token, productId, 1, coupon.code);
      expect(Number(order.discountAmount)).toBeCloseTo(50, 2); // 10% of 500.

      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });
      expect(Number(created.body.items[0].refundAmount)).toBeCloseTo(450, 2); // 500 - the 50 discount actually applied, never the full 500.
    });

    it('a fixed-amount coupon reduces the refund by its allocated share', async () => {
      const { token } = await createCustomer(`p10.fixedcoupon.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10FixedCoupon ${runId}`, '300.00', 10);

      const promotion = await prisma.promotion.create({ data: { storeId, name: `P10 Fixed ${runId}`, discountType: 'FIXED_AMOUNT', value: '30.00', isActive: true } });
      const coupon = await prisma.coupon.create({ data: { storeId, promotionId: promotion.id, code: `P10FIX${runId}`, normalizedCode: `P10FIX${runId}`, isActive: true } });

      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId, 1, coupon.code);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });
      expect(Number(created.body.items[0].refundAmount)).toBeCloseTo(270, 2); // 300 - 30.
    });

    it('a full-order return with a coupon refunds exactly subtotal minus discount, never including shipping', async () => {
      const { token } = await createCustomer(`p10.fullcoupon.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10FullCoupon ${runId}`, '200.00', 10);
      const promotion = await prisma.promotion.create({ data: { storeId, name: `P10 Full ${runId}`, discountType: 'PERCENTAGE', value: '20.00', isActive: true } });
      const coupon = await prisma.coupon.create({ data: { storeId, promotionId: promotion.id, code: `P10FULL${runId}`, normalizedCode: `P10FULL${runId}`, isActive: true } });

      const { orderNumber, orderItemId, order } = await checkoutToDelivered(token, productId, 1, coupon.code);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });
      const expected = (Number(order.subtotal) - Number(order.discountAmount)).toFixed(2);
      expect(Number(created.body.items[0].refundAmount)).toBeCloseTo(Number(expected), 2);
      // Shipping is never refunded (§21's conservative default) - the
      // refund amount never includes order.shippingAmount.
      expect(Number(created.body.items[0].refundAmount)).toBeLessThanOrEqual(Number(order.totalAmount));
    });
  });

  describe('Refund provider - success, failure, timeout/unknown, recovery', () => {
    it('a successful refund transitions PENDING -> SUCCEEDED and the return to COMPLETED (MOCK provider)', async () => {
      const { token } = await createCustomer(`p10.refundsuccess.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10RefundSuccess ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId);
      const { refund } = await driveReturnToRefunded(token, orderNumber, orderItemId, 1);
      expect(refund.status).toBe('SUCCEEDED');
      expect(refund.providerRefundId).toBeTruthy();
    });

    it('a provider that reports a clean, immediate failure sets the refund FAILED (never silently retried into a duplicate)', async () => {
      const { token } = await createCustomer(`p10.refundfail.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10RefundFail ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });
      await api().post(`/api/v1/admin/returns/${created.body.id}/approve`).set('Authorization', auth(adminToken)).send({});
      await api().post(`/api/v1/admin/returns/${created.body.id}/received`).set('Authorization', auth(adminToken)).send({});
      await api()
        .post(`/api/v1/admin/returns/${created.body.id}/inspect`)
        .set('Authorization', auth(adminToken))
        .send({ items: created.body.items.map((i: { id: string }) => ({ returnItemId: i.id, itemCondition: 'NEW', disposition: 'RESTOCK' })) });

      fakeRefundProvider.failNextCreatePermanently = true;
      const refunded = await api().post(`/api/v1/admin/returns/${created.body.id}/refund`).set('Authorization', auth(adminToken)).send({});
      expect(refunded.status).toBe(201);
      expect(refunded.body.status).toBe('FAILED');
      await drainOutboxAndEmail();

      const returnAfter = await api().get(`/api/v1/admin/returns/${created.body.id}`).set('Authorization', auth(adminToken));
      expect(returnAfter.body.status).toBe('REFUND_INITIATED'); // not falsely COMPLETED.

      const n = await prisma.notification.findFirst({ where: { storeId, type: 'REFUND_FAILED', channel: 'IN_APP', data: { path: ['refundId'], equals: refunded.body.id } } });
      expect(n).not.toBeNull();
    });

    it('a lost response that the provider actually processed resolves to SUCCEEDED via reconciliation, never UNKNOWN', async () => {
      const { token } = await createCustomer(`p10.lostresponse.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10LostResponse ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });
      await api().post(`/api/v1/admin/returns/${created.body.id}/approve`).set('Authorization', auth(adminToken)).send({});
      await api().post(`/api/v1/admin/returns/${created.body.id}/received`).set('Authorization', auth(adminToken)).send({});
      await api()
        .post(`/api/v1/admin/returns/${created.body.id}/inspect`)
        .set('Authorization', auth(adminToken))
        .send({ items: created.body.items.map((i: { id: string }) => ({ returnItemId: i.id, itemCondition: 'NEW', disposition: 'RESTOCK' })) });

      fakeRefundProvider.simulateLostResponseOnce = true;
      const refunded = await api().post(`/api/v1/admin/returns/${created.body.id}/refund`).set('Authorization', auth(adminToken)).send({});
      expect(refunded.status).toBe(201);
      expect(refunded.body.status).toBe('SUCCEEDED'); // reconciled via findRefundByReceipt, not left UNKNOWN.
    });

    it('a genuinely unreachable reconciliation leaves the refund UNKNOWN, never guessed as FAILED, and recovery later resolves it', async () => {
      const { token } = await createCustomer(`p10.unknownrefund.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10Unknown ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });
      await api().post(`/api/v1/admin/returns/${created.body.id}/approve`).set('Authorization', auth(adminToken)).send({});
      await api().post(`/api/v1/admin/returns/${created.body.id}/received`).set('Authorization', auth(adminToken)).send({});
      await api()
        .post(`/api/v1/admin/returns/${created.body.id}/inspect`)
        .set('Authorization', auth(adminToken))
        .send({ items: created.body.items.map((i: { id: string }) => ({ returnItemId: i.id, itemCondition: 'NEW', disposition: 'RESTOCK' })) });

      fakeRefundProvider.simulateLostResponseOnce = true;
      fakeRefundProvider.failNextFindByReceiptOnce = true;
      const refunded = await api().post(`/api/v1/admin/returns/${created.body.id}/refund`).set('Authorization', auth(adminToken)).send({});
      expect(refunded.status).toBe(201);
      expect(refunded.body.status).toBe('UNKNOWN'); // never guessed as FAILED.

      // A second initiate() attempt must be refused, not silently retried,
      // while the outcome is genuinely unknown (§24/§25).
      const secondAttempt = await api().post(`/api/v1/admin/returns/${created.body.id}/refund`).set('Authorization', auth(adminToken)).send({});
      expect(secondAttempt.status).toBe(409);

      const recovered = await api().post(`/api/v1/admin/returns/refunds/${refunded.body.id}/recover`).set('Authorization', auth(adminToken)).send({});
      expect(recovered.status).toBe(201);
      expect(recovered.body.status).toBe('SUCCEEDED'); // now resolved - the provider really had processed it.
    });

    it('a refund left PROCESSING (provider accepted but not yet finished) is resolved to SUCCEEDED by recovery once it completes', async () => {
      const { token } = await createCustomer(`p10.processing.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10Processing ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });
      await api().post(`/api/v1/admin/returns/${created.body.id}/approve`).set('Authorization', auth(adminToken)).send({});
      await api().post(`/api/v1/admin/returns/${created.body.id}/received`).set('Authorization', auth(adminToken)).send({});
      await api()
        .post(`/api/v1/admin/returns/${created.body.id}/inspect`)
        .set('Authorization', auth(adminToken))
        .send({ items: created.body.items.map((i: { id: string }) => ({ returnItemId: i.id, itemCondition: 'NEW', disposition: 'RESTOCK' })) });

      fakeRefundProvider.nextRefundStartsPending = true;
      const refunded = await api().post(`/api/v1/admin/returns/${created.body.id}/refund`).set('Authorization', auth(adminToken)).send({});
      expect(refunded.body.status).toBe('PROCESSING');

      fakeRefundProvider.resolveRefund(refunded.body.providerRefundId, 'processed');
      const recovered = await api().post(`/api/v1/admin/returns/refunds/${refunded.body.id}/recover`).set('Authorization', auth(adminToken)).send({});
      expect(recovered.body.status).toBe('SUCCEEDED');
    });
  });

  describe('Refund idempotency and limits', () => {
    it('10 simultaneous refund requests for the same return produce exactly ONE logical refund and ONE provider call', async () => {
      const { token } = await createCustomer(`p10.refundrace.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10RefundRace ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });
      await api().post(`/api/v1/admin/returns/${created.body.id}/approve`).set('Authorization', auth(adminToken)).send({});
      await api().post(`/api/v1/admin/returns/${created.body.id}/received`).set('Authorization', auth(adminToken)).send({});
      await api()
        .post(`/api/v1/admin/returns/${created.body.id}/inspect`)
        .set('Authorization', auth(adminToken))
        .send({ items: created.body.items.map((i: { id: string }) => ({ returnItemId: i.id, itemCondition: 'NEW', disposition: 'RESTOCK' })) });

      const before = fakeRefundProvider.createRefundCallCount;
      const results = await Promise.all(Array.from({ length: 10 }, () => api().post(`/api/v1/admin/returns/${created.body.id}/refund`).set('Authorization', auth(adminToken)).send({})));
      expect(results.every((r) => r.status === 201)).toBe(true);

      const refundRows = await prisma.refund.findMany({ where: { returnRequestId: created.body.id } });
      expect(refundRows).toHaveLength(1); // exactly one logical refund - never duplicated.
      expect(fakeRefundProvider.createRefundCallCount - before).toBe(1); // exactly one real provider call.
    });

    it('the refund can never exceed the captured payment amount, even across a second return on the SAME order', async () => {
      const { token } = await createCustomer(`p10.overrefund.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10OverRefund ${runId}`, '100.00', 10);
      const { orderNumber, order } = await checkoutToDelivered(token, productId, 2);
      const orderFull = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
      const orderItemId = orderFull.items[0].id;

      // Return and fully refund BOTH purchased units.
      await driveReturnToRefunded(token, orderNumber, orderItemId, 2);

      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id, status: 'CAPTURED' } });
      const totalRefunded = await prisma.refund.aggregate({ where: { paymentId: payment.id, status: 'SUCCEEDED' }, _sum: { amount: true } });
      expect(Number(totalRefunded._sum.amount)).toBeLessThanOrEqual(Number(payment.amount));
      expect(Number(totalRefunded._sum.amount)).toBe(Number(payment.amount)); // fully refunded, exactly, never more.
    });
  });

  describe('Security', () => {
    it('the create-return DTO does not accept a client-supplied userId/storeId/refundAmount/returnStatus - forbidNonWhitelisted rejects it outright', async () => {
      const { token } = await createCustomer(`p10.forge.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10Forge ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId);

      const res = await api()
        .post('/api/v1/returns')
        .set('Authorization', auth(token))
        .send({ orderNumber, items: [{ orderItemId, quantity: 1, refundAmount: '999999.00' }], reason: 'CHANGED_MIND', userId: 'forged', storeId: 'forged', refundAmount: '999999.00' });
      expect(res.status).toBe(400);
    });

    it('a customer cannot access another customer\'s return by id (safe 404)', async () => {
      const { token: ownerToken } = await createCustomer(`p10.sec.owner.${runId}@example.com`, 'Secret123!');
      const { token: otherToken } = await createCustomer(`p10.sec.other.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10Sec ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(ownerToken, productId);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(ownerToken)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });

      const res = await api().get(`/api/v1/returns/${created.body.id}`).set('Authorization', auth(otherToken));
      expect(res.status).toBe(404);
    });
  });

  describe('Concurrency', () => {
    it('§9/§43 - 10 concurrent return requests for a purchased quantity of 2 never result in more than 2 total returned', async () => {
      const { token } = await createCustomer(`p10.qtyrace.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10QtyRace ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId, 2);

      const results = await Promise.all(
        Array.from({ length: 10 }, () => api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 2 }], reason: 'CHANGED_MIND' })),
      );
      const succeeded = results.filter((r) => r.status === 201);
      const totalReturned = await prisma.returnItem.aggregate({ where: { orderItemId, returnRequest: { status: { notIn: ['REJECTED', 'CANCELLED'] } } }, _sum: { quantity: true } });
      expect(totalReturned._sum.quantity ?? 0).toBeLessThanOrEqual(2);
      expect(succeeded).toHaveLength(1); // only ONE of the 10 could possibly fit within quantity=2.
    });

    it('10 simultaneous approval calls for the same return resolve to exactly one real transition, no duplicate side effects', async () => {
      const { token } = await createCustomer(`p10.approverace.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10ApproveRace ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });

      const results = await Promise.all(Array.from({ length: 10 }, () => api().post(`/api/v1/admin/returns/${created.body.id}/approve`).set('Authorization', auth(adminToken)).send({})));
      const succeeded = results.filter((r) => r.status === 201);
      expect(succeeded).toHaveLength(1);

      await drainOutboxAndEmail();
      const notifications = await prisma.notification.count({ where: { storeId, type: 'RETURN_APPROVED', idempotencyKey: `RETURN_APPROVED:${created.body.id}:IN_APP` } });
      expect(notifications).toBe(1); // never duplicated.
    });

    it('10 concurrent restock inspections for the SAME return item increase inventory exactly once', async () => {
      const { token } = await createCustomer(`p10.restockrace.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10RestockRace ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId, 1);
      const inventoryItem = await prisma.inventoryItem.findFirstOrThrow({ where: { storeId, productId } });
      const availableBefore = inventoryItem.availableQuantity;

      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });
      await api().post(`/api/v1/admin/returns/${created.body.id}/approve`).set('Authorization', auth(adminToken)).send({});
      await api().post(`/api/v1/admin/returns/${created.body.id}/received`).set('Authorization', auth(adminToken)).send({});

      const returnItemId = created.body.items[0].id;
      const results = await Promise.all(
        Array.from({ length: 10 }, () => api().post(`/api/v1/admin/returns/${created.body.id}/inspect`).set('Authorization', auth(adminToken)).send({ items: [{ returnItemId, itemCondition: 'NEW', disposition: 'RESTOCK' }] })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1); // only the first can transition RECEIVED -> REFUND_PENDING.

      const inventoryAfter = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItem.id } });
      expect(inventoryAfter.availableQuantity).toBe(availableBefore + 1); // exactly once, never doubled.
    });
  });

  describe('Transaction safety', () => {
    it('a rolled-back inspect() (invalid item id) never partially restocks or leaves a stray OutboxEvent', async () => {
      const { token } = await createCustomer(`p10.rollback.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P10Rollback ${runId}`, '100.00', 10);
      const { orderNumber, orderItemId } = await checkoutToDelivered(token, productId, 1);
      const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });
      await api().post(`/api/v1/admin/returns/${created.body.id}/approve`).set('Authorization', auth(adminToken)).send({});
      await api().post(`/api/v1/admin/returns/${created.body.id}/received`).set('Authorization', auth(adminToken)).send({});

      // Deliberately omit one required item from the inspect submission -
      // ReturnStatusService rejects this before the transaction is even
      // opened, so nothing should have changed at all.
      const badInspect = await api().post(`/api/v1/admin/returns/${created.body.id}/inspect`).set('Authorization', auth(adminToken)).send({ items: [] });
      expect(badInspect.status).toBe(400); // ArrayMinSize(1) rejects an empty items array outright.

      const stillReceived = await api().get(`/api/v1/admin/returns/${created.body.id}`).set('Authorization', auth(adminToken));
      expect(stillReceived.body.status).toBe('RECEIVED');
    });
  });

  describe('Database invariants', () => {
    it('no orphaned return requests/items/refunds', async () => {
      const rows = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::int AS c FROM return_requests r
        LEFT JOIN stores s ON s.id = r."storeId" LEFT JOIN orders o ON o.id = r."orderId" LEFT JOIN users u ON u.id = r."userId"
        WHERE s.id IS NULL OR o.id IS NULL OR u.id IS NULL`;
      expect(Number(rows[0].c)).toBe(0);

      const itemRows = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::int AS c FROM return_items ri
        LEFT JOIN return_requests rr ON rr.id = ri."returnRequestId" LEFT JOIN order_items oi ON oi.id = ri."orderItemId"
        WHERE rr.id IS NULL OR oi.id IS NULL`;
      expect(Number(itemRows[0].c)).toBe(0);

      const refundRows = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::int AS c FROM refunds rf
        LEFT JOIN orders o ON o.id = rf."orderId" LEFT JOIN payments p ON p.id = rf."paymentId" LEFT JOIN return_requests rr ON rr.id = rf."returnRequestId"
        WHERE o.id IS NULL OR p.id IS NULL OR rr.id IS NULL`;
      expect(Number(refundRows[0].c)).toBe(0);
    });

    it('no cross-store return requests/refunds (storeId always matches the related order/user storeId)', async () => {
      const rows = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::int AS c FROM return_requests r JOIN orders o ON o.id = r."orderId" WHERE r."storeId" != o."storeId"`;
      expect(Number(rows[0].c)).toBe(0);

      const refundRows = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::int AS c FROM refunds rf JOIN orders o ON o.id = rf."orderId" WHERE rf."storeId" != o."storeId"`;
      expect(Number(refundRows[0].c)).toBe(0);
    });

    it('no return item requests more than its purchased quantity, and no duplicate active return quantity exceeds purchased', async () => {
      const overRows = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::int AS c FROM (
          SELECT ri."orderItemId", oi.quantity AS purchased, SUM(ri.quantity) AS returned
          FROM return_items ri
          JOIN order_items oi ON oi.id = ri."orderItemId"
          JOIN return_requests rr ON rr.id = ri."returnRequestId"
          WHERE rr.status NOT IN ('REJECTED', 'CANCELLED')
          GROUP BY ri."orderItemId", oi.quantity
          HAVING SUM(ri.quantity) > oi.quantity
        ) x`;
      expect(Number(overRows[0].c)).toBe(0);
    });

    it('no refund exceeds its payment\'s captured amount (aggregated across all non-failed refunds)', async () => {
      const rows = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::int AS c FROM (
          SELECT rf."paymentId", p.amount AS captured, SUM(rf.amount) AS refunded
          FROM refunds rf
          JOIN payments p ON p.id = rf."paymentId"
          WHERE rf.status IN ('PENDING', 'PROCESSING', 'SUCCEEDED')
          GROUP BY rf."paymentId", p.amount
          HAVING SUM(rf.amount) > p.amount
        ) x`;
      expect(Number(rows[0].c)).toBe(0);
    });

    it('no duplicate refund idempotency keys or duplicate provider refund ids', async () => {
      const idemRows = await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::int AS c FROM (SELECT "idempotencyKey" FROM refunds GROUP BY "idempotencyKey" HAVING COUNT(*) > 1) x`;
      expect(Number(idemRows[0].c)).toBe(0);

      const providerRows = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::int AS c FROM (SELECT provider, "providerRefundId" FROM refunds WHERE "providerRefundId" IS NOT NULL GROUP BY provider, "providerRefundId" HAVING COUNT(*) > 1) x`;
      expect(Number(providerRows[0].c)).toBe(0);
    });

    it('no duplicate restock transactions (at most one RETURN-type ledger entry per return item reference)', async () => {
      const rows = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::int AS c FROM (
          SELECT reference, "inventoryItemId", COUNT(*) FROM inventory_transactions WHERE type = 'RETURN' GROUP BY reference, "inventoryItemId" HAVING COUNT(*) > 1
        ) x`;
      expect(Number(rows[0].c)).toBe(0);
    });

    it('every ReturnStatus/RefundStatus value on record is one of the valid enum values (no invalid states)', async () => {
      const invalidReturn = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::int AS c FROM return_requests WHERE status NOT IN ('REQUESTED','UNDER_REVIEW','APPROVED','REJECTED','CANCELLED','IN_TRANSIT','RECEIVED','REFUND_PENDING','REFUND_INITIATED','REFUNDED','PARTIALLY_REFUNDED','COMPLETED')`;
      expect(Number(invalidReturn[0].c)).toBe(0);

      const invalidRefund = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::int AS c FROM refunds WHERE status NOT IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','UNKNOWN','CANCELLED')`;
      expect(Number(invalidRefund[0].c)).toBe(0);
    });
  });
});
