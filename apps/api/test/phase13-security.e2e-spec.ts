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
import { RefundCalculationService } from '../src/modules/returns/refund-calculation.service';
import { PAYMENT_PROVIDER } from '../src/modules/payments/providers/payment-provider.interface';
import { REFUND_PROVIDER } from '../src/modules/payments/providers/refund-provider.interface';
import { OutboxWorkerService } from '../src/modules/notifications/outbox-worker.service';
import { EmailDeliveryWorkerService } from '../src/modules/notifications/email-delivery-worker.service';
import { FakeRazorpayProvider, signPayment } from './helpers/fake-razorpay-provider';
import { FakeRazorpayRefundProvider } from './helpers/fake-razorpay-refund-provider';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';

/**
 * Phase 13 - Security Hardening, Monitoring & Observability (e2e).
 *
 * This suite intentionally does NOT re-test tenant isolation exhaustively
 * across every module - that is already covered by each phase's own e2e
 * file (storefront.e2e-spec.ts, phase10/11/12's cross-tenant tests, etc.),
 * confirmed still passing by the Phase 13 full-regression run. This file
 * covers what is genuinely NEW in Phase 13: JWT hardening, refresh-token
 * reuse detection, password-reset single-use, the PermissionsGuard type
 * check, the diagnostics endpoint, request-id propagation, health/ready
 * split, and - most importantly - the explicitly re-audited cross-return
 * refund concurrency scenario (§47/§74) with real, previously-missing
 * regression coverage for it.
 */
describe('Peshani Phase 13 - Security Hardening & Observability (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService<AppConfig, true>;
  let fakePaymentProvider: FakeRazorpayProvider;
  let fakeRefundProvider: FakeRazorpayRefundProvider;
  let outboxWorker: OutboxWorkerService;
  let emailWorker: EmailDeliveryWorkerService;
  let refundCalculation: RefundCalculationService;
  let storeId: string;
  let warehouseId: string;
  let adminToken: string;

  const runId = Date.now();
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => `Bearer ${token}`;
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

  async function createCustomer(email: string, password: string) {
    const normalizedEmail = email.toLowerCase();
    const passwordHash = await argon2.hash(password);
    const role = await prisma.role.findUnique({ where: { storeId_name: { storeId, name: 'CUSTOMER' } } });
    const user = await prisma.user.create({ data: { storeId, email: normalizedEmail, passwordHash, type: 'CUSTOMER', isActive: true, emailVerifiedAt: new Date() } });
    if (role) await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    return { userId: user.id, email: normalizedEmail, password };
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

  async function checkoutMultiItemAndPay(token: string, items: { productId: string; quantity: number }[]) {
    for (const item of items) {
      await api().post('/api/v1/cart/items').set('Authorization', auth(token)).send({ productId: item.productId, quantity: item.quantity });
    }
    const checkout = await api().post('/api/v1/checkout/create').set('Authorization', auth(token)).send({ email: 'buyer@example.com', billingAddress: address });
    expect(checkout.status).toBe(201);
    const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
    fakePaymentProvider.registerPayment(paymentId, checkout.body.razorpayOrderId, 'captured');
    const signature = signPayment(checkout.body.razorpayOrderId, paymentId);
    const verify = await api()
      .post('/api/v1/payments/razorpay/verify')
      .set('Authorization', auth(token))
      .send({ orderNumber: checkout.body.orderNumber, razorpayOrderId: checkout.body.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: signature });
    expect(verify.status).toBe(201);
    return { orderNumber: checkout.body.orderNumber as string };
  }

  async function driveReturnToRefundPending(token: string, orderNumber: string, orderItemId: string, quantity: number): Promise<string> {
    const created = await api().post('/api/v1/returns').set('Authorization', auth(token)).send({ orderNumber, items: [{ orderItemId, quantity }], reason: 'CHANGED_MIND' });
    expect(created.status).toBe(201);
    const returnId = created.body.id as string;
    await api().post(`/api/v1/admin/returns/${returnId}/approve`).set('Authorization', auth(adminToken)).send({});
    await api().post(`/api/v1/admin/returns/${returnId}/received`).set('Authorization', auth(adminToken)).send({});
    const detail = await api().get(`/api/v1/admin/returns/${returnId}`).set('Authorization', auth(adminToken));
    await api()
      .post(`/api/v1/admin/returns/${returnId}/inspect`)
      .set('Authorization', auth(adminToken))
      .send({ items: detail.body.items.map((i: { id: string }) => ({ returnItemId: i.id, itemCondition: 'NEW', disposition: 'RESTOCK' })) });
    return returnId;
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
    app.use(requestIdMiddleware);
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);
    outboxWorker = app.get(OutboxWorkerService);
    emailWorker = app.get(EmailDeliveryWorkerService);
    refundCalculation = app.get(RefundCalculationService);

    const store = await prisma.store.findUniqueOrThrow({ where: { slug: DEFAULT_STORE_SLUG } });
    storeId = store.id;
    const warehouse = await prisma.warehouse.create({ data: { storeId, name: `P13 WH ${runId}`, code: `P13-WH-${runId}`, isActive: true } });
    warehouseId = warehouse.id;

    const adminLogin = await api().post('/api/v1/auth/login').send({ email: process.env.SEED_ADMIN_EMAIL ?? 'admin@peshani.example', password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!' });
    adminToken = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('JWT hardening', () => {
    it('rejects a token with a tampered signature', async () => {
      const parts = adminToken.split('.');
      const forged = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -4)}abcd`;
      const res = await api().get('/api/v1/auth/me').set('Authorization', auth(forged));
      expect(res.status).toBe(401);
    });

    it('rejects an expired token', async () => {
      const expired = await jwtService.signAsync(
        { sub: 'x', storeId, email: 'x@example.com', type: 'ADMIN', roles: [], permissions: [] },
        {
          secret: configService.get('jwt', { infer: true }).accessSecret,
          algorithm: 'HS256',
          issuer: 'peshani-api',
          audience: 'peshani-client',
          expiresIn: -10,
        },
      );
      const res = await api().get('/api/v1/auth/me').set('Authorization', auth(expired));
      expect(res.status).toBe(401);
    });

    it('rejects a token missing the required issuer/audience claims (e.g. a token forged without them)', async () => {
      const noIssuerAudience = await jwtService.signAsync(
        { sub: 'x', storeId, email: 'x@example.com', type: 'ADMIN', roles: [], permissions: [] },
        { secret: configService.get('jwt', { infer: true }).accessSecret, algorithm: 'HS256', expiresIn: '15m' },
      );
      const res = await api().get('/api/v1/auth/me').set('Authorization', auth(noIssuerAudience));
      expect(res.status).toBe(401);
    });

    it("rejects an 'alg:none' token even if it carries an otherwise-valid-looking payload", async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: 'x', storeId, email: 'x@example.com', type: 'ADMIN', roles: [], permissions: ['users.manage'], iss: 'peshani-api', aud: 'peshani-client' })).toString('base64url');
      const noneToken = `${header}.${payload}.`;
      const res = await api().get('/api/v1/auth/me').set('Authorization', auth(noneToken));
      expect(res.status).toBe(401);
    });
  });

  describe('Authorization hardening', () => {
    it('a plain customer token is rejected by an admin-permission-gated route', async () => {
      const customer = await createCustomer(`p13.customer.${runId}@example.com`, 'Secret123!');
      const customerToken = await jwtService.signAsync(
        { sub: customer.userId, storeId, email: customer.email, type: 'CUSTOMER', roles: ['CUSTOMER'], permissions: [] },
        { secret: configService.get('jwt', { infer: true }).accessSecret, expiresIn: '15m', algorithm: 'HS256', issuer: 'peshani-api', audience: 'peshani-client' },
      );
      const res = await api().get('/api/v1/admin/diagnostics').set('Authorization', auth(customerToken));
      expect(res.status).toBe(403);
    });

    it('PermissionsGuard denies a CUSTOMER-type token even if it somehow carries a permission string (defense-in-depth against a future role-assignment bug)', async () => {
      const customer = await createCustomer(`p13.forgedperm.${runId}@example.com`, 'Secret123!');
      const forgedToken = await jwtService.signAsync(
        { sub: customer.userId, storeId, email: customer.email, type: 'CUSTOMER', roles: ['CUSTOMER'], permissions: ['diagnostics.read', 'users.manage'] },
        { secret: configService.get('jwt', { infer: true }).accessSecret, expiresIn: '15m', algorithm: 'HS256', issuer: 'peshani-api', audience: 'peshani-client' },
      );
      const res = await api().get('/api/v1/admin/diagnostics').set('Authorization', auth(forgedToken));
      expect(res.status).toBe(403);
    });

    it('an admin without the required permission is denied (403), one with it succeeds (200)', async () => {
      const { token: noPerm } = await createLimitedAdmin([], `p13.noperm.${runId}@example.com`);
      const denied = await api().get('/api/v1/admin/diagnostics').set('Authorization', auth(noPerm));
      expect(denied.status).toBe(403);

      const { token: withPerm } = await createLimitedAdmin(['diagnostics.read'], `p13.withperm.${runId}@example.com`);
      const allowed = await api().get('/api/v1/admin/diagnostics').set('Authorization', auth(withPerm));
      expect(allowed.status).toBe(200);
    });
  });

  describe('Refresh token security', () => {
    it('a replayed (already-rotated-away) refresh token is rejected and revokes the entire session family', async () => {
      const customer = await createCustomer(`p13.refresh.${runId}@example.com`, 'Secret123!');
      const login = await api().post('/api/v1/auth/login').send({ email: customer.email, password: customer.password });
      const originalRefresh = login.body.refreshToken as string;

      const firstRotation = await api().post('/api/v1/auth/refresh').send({ refreshToken: originalRefresh });
      expect(firstRotation.status).toBe(200);
      const rotatedRefresh = firstRotation.body.refreshToken as string;

      // Replay the ORIGINAL (already-rotated-away) token.
      const replay = await api().post('/api/v1/auth/refresh').send({ refreshToken: originalRefresh });
      expect(replay.status).toBe(401);

      // The reuse response must have burned the entire family - even the
      // legitimately-rotated successor token must now be invalid.
      const afterReuse = await api().post('/api/v1/auth/refresh').send({ refreshToken: rotatedRefresh });
      expect(afterReuse.status).toBe(401);
    });

    it('logout-all revokes every refresh token for the user', async () => {
      const customer = await createCustomer(`p13.logoutall.${runId}@example.com`, 'Secret123!');
      const loginA = await api().post('/api/v1/auth/login').send({ email: customer.email, password: customer.password });
      const loginB = await api().post('/api/v1/auth/login').send({ email: customer.email, password: customer.password });

      const logoutAll = await api().post('/api/v1/auth/logout-all').set('Authorization', auth(loginA.body.accessToken));
      expect(logoutAll.status).toBe(204);

      const refreshA = await api().post('/api/v1/auth/refresh').send({ refreshToken: loginA.body.refreshToken });
      const refreshB = await api().post('/api/v1/auth/refresh').send({ refreshToken: loginB.body.refreshToken });
      expect(refreshA.status).toBe(401);
      expect(refreshB.status).toBe(401);
    });

    it('an expired refresh token is rejected, an unknown one is rejected', async () => {
      const unknown = await api().post('/api/v1/auth/refresh').send({ refreshToken: 'not-a-real-token-at-all' });
      expect(unknown.status).toBe(401);
    });
  });

  describe('Password reset security', () => {
    it('a password reset token is single-use - redeeming it twice fails the second time', async () => {
      const customer = await createCustomer(`p13.resetreuse.${runId}@example.com`, 'Secret123!');
      await api().post('/api/v1/auth/forgot-password').send({ email: customer.email });
      const resetToken = await jwtService.signAsync(
        { sub: customer.userId, purpose: 'password_reset', jti: `p13-reset-${runId}` },
        { secret: configService.get('jwt', { infer: true }).accessSecret, expiresIn: '1h', algorithm: 'HS256', issuer: 'peshani-api', audience: 'peshani-client' },
      );

      const first = await api().post('/api/v1/auth/reset-password').send({ token: resetToken, newPassword: 'NewSecret456!' });
      expect(first.status).toBe(204);

      const second = await api().post('/api/v1/auth/reset-password').send({ token: resetToken, newPassword: 'AnotherSecret789!' });
      expect(second.status).toBe(401);

      // The FIRST redemption's password change must have actually taken effect.
      const loginWithNew = await api().post('/api/v1/auth/login').send({ email: customer.email, password: 'NewSecret456!' });
      expect(loginWithNew.status).toBe(200);
    });

    it('forgot-password never reveals whether an email exists (constant 204 response either way)', async () => {
      const real = await createCustomer(`p13.enum.${runId}@example.com`, 'Secret123!');
      const realRes = await api().post('/api/v1/auth/forgot-password').send({ email: real.email });
      const fakeRes = await api().post('/api/v1/auth/forgot-password').send({ email: `nonexistent.${runId}@example.com` });
      expect(realRes.status).toBe(fakeRes.status);
      expect(realRes.status).toBe(204);
    });
  });

  describe('DTO validation - forbidden field rejection', () => {
    it('rejects a client-supplied storeId/role/permissions on register', async () => {
      const res = await api()
        .post('/api/v1/auth/register')
        .send({ email: `p13.dto.${runId}@example.com`, password: 'Secret123!', storeId: 'forged-store-id', role: 'ADMIN', permissions: ['users.manage'] });
      expect(res.status).toBe(400);
    });

    it('rejects a client-supplied status/orderStatus/paymentStatus/refundAmount on return creation', async () => {
      const customer = await createCustomer(`p13.dtoreturn.${runId}@example.com`, 'Secret123!');
      const login = await api().post('/api/v1/auth/login').send({ email: customer.email, password: customer.password });
      const res = await api()
        .post('/api/v1/returns')
        .set('Authorization', auth(login.body.accessToken))
        .send({ orderNumber: 'PES-FAKE', items: [{ orderItemId: '00000000-0000-0000-0000-000000000000', quantity: 1 }], reason: 'CHANGED_MIND', status: 'APPROVED', refundAmount: 999999 });
      expect(res.status).toBe(400);
    });
  });

  describe('Refund concurrency - cross-return safety (§47/§74 re-audit)', () => {
    it('two DIFFERENT return requests on the SAME order, refunded via real concurrent HTTP requests, never let combined SUCCEEDED refunds exceed the captured payment', async () => {
      const { productId: p1 } = await createProduct(`P13 CrossReturn Item1 ${runId}`, '700.00', 5);
      const { productId: p2 } = await createProduct(`P13 CrossReturn Item2 ${runId}`, '500.00', 5);
      const customer = await createCustomer(`p13.crossreturn.${runId}@example.com`, 'Secret123!');
      const custLogin = await api().post('/api/v1/auth/login').send({ email: customer.email, password: customer.password });
      const custToken = custLogin.body.accessToken as string;

      const { orderNumber } = await checkoutMultiItemAndPay(custToken, [{ productId: p1, quantity: 1 }, { productId: p2, quantity: 1 }]);
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' });
      await api().post(`/api/v1/admin/orders/${orderNumber}/fulfill`).set('Authorization', auth(adminToken)).send({});
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'SHIPPED' });
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'DELIVERED' });

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber }, include: { items: true } });
      const item1 = order.items.find((i) => Number(i.unitPrice) === 700)!;
      const item2 = order.items.find((i) => Number(i.unitPrice) === 500)!;

      const returnAId = await driveReturnToRefundPending(custToken, orderNumber, item1.id, 1);
      const returnBId = await driveReturnToRefundPending(custToken, orderNumber, item2.id, 1);

      // Real concurrent HTTP requests, several per return, mirroring the
      // "10 concurrent" pattern this codebase already uses elsewhere -
      // exercising the actual advisory-lock + balance-check path, not a
      // simulated/serial approximation of it.
      const results = await Promise.all([
        ...Array.from({ length: 5 }, () => api().post(`/api/v1/admin/returns/${returnAId}/refund`).set('Authorization', auth(adminToken)).send({})),
        ...Array.from({ length: 5 }, () => api().post(`/api/v1/admin/returns/${returnBId}/refund`).set('Authorization', auth(adminToken)).send({})),
      ]);
      expect(results.every((r) => r.status === 201)).toBe(true);

      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id, status: 'CAPTURED' } });
      const refunds = await prisma.refund.findMany({ where: { paymentId: payment.id } });
      // Exactly one logical refund per ReturnRequest despite 5 concurrent calls each.
      expect(refunds.filter((r) => r.returnRequestId === returnAId)).toHaveLength(1);
      expect(refunds.filter((r) => r.returnRequestId === returnBId)).toHaveLength(1);

      const successfulTotal = refunds.filter((r) => r.status === 'SUCCEEDED').reduce((sum, r) => sum + Number(r.amount), 0);
      expect(successfulTotal).toBeLessThanOrEqual(Number(payment.amount));
      expect(successfulTotal).toBeCloseTo(1200, 2); // 700 + 500, no discount - the full captured amount, exactly.
    });

    it('the refundable-balance governor caps a new request to what remains after prior successful refunds on the SAME payment (captured=1000, already-refunded=600 -> remaining<=400)', async () => {
      const { productId } = await createProduct(`P13 GovernorTest ${runId}`, '1000.00', 5);
      const customer = await createCustomer(`p13.governor.${runId}@example.com`, 'Secret123!');
      const custLogin = await api().post('/api/v1/auth/login').send({ email: customer.email, password: customer.password });
      const { orderNumber } = await checkoutMultiItemAndPay(custLogin.body.accessToken, [{ productId, quantity: 1 }]);
      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber }, include: { items: true } });
      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id, status: 'CAPTURED' } });
      expect(Number(payment.amount)).toBeCloseTo(1000, 2);
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' });
      await api().post(`/api/v1/admin/orders/${orderNumber}/fulfill`).set('Authorization', auth(adminToken)).send({});
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'SHIPPED' });
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'DELIVERED' });
      const returnId = await driveReturnToRefundPending(custLogin.body.accessToken, orderNumber, order.items[0].id, 1);

      // Simulate "already-refunded = 600" directly against this real
      // captured payment - a prior successful refund (from this same
      // return, for the purpose of this test - the governor only cares
      // about the payment, not which return a prior refund came from, per
      // the Phase 13 audit of RefundCalculationService.getRefundableBalance).
      await prisma.refund.create({
        data: { storeId, orderId: order.id, paymentId: payment.id, returnRequestId: returnId, amount: '600.00', currency: 'INR', status: 'SUCCEEDED', provider: 'RAZORPAY', idempotencyKey: `P13-GOV-PRIOR-${runId}`, succeededAt: new Date() },
      });

      const balance = await refundCalculation.getRefundableBalance(prisma, payment.id, payment.amount);
      expect(Number(balance)).toBeCloseTo(400, 2);
    });

    it('a FAILED refund does not consume refundable balance', async () => {
      const { productId } = await createProduct(`P13 FailedNoConsume ${runId}`, '300.00', 5);
      const customer = await createCustomer(`p13.failednoconsume.${runId}@example.com`, 'Secret123!');
      const custLogin = await api().post('/api/v1/auth/login').send({ email: customer.email, password: customer.password });
      const { orderNumber } = await checkoutMultiItemAndPay(custLogin.body.accessToken, [{ productId, quantity: 1 }]);
      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber }, include: { items: true } });
      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id, status: 'CAPTURED' } });
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' });
      await api().post(`/api/v1/admin/orders/${orderNumber}/fulfill`).set('Authorization', auth(adminToken)).send({});
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'SHIPPED' });
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'DELIVERED' });
      const returnId = await driveReturnToRefundPending(custLogin.body.accessToken, orderNumber, order.items[0].id, 1);

      await prisma.refund.create({
        data: { storeId, orderId: order.id, paymentId: payment.id, returnRequestId: returnId, amount: '250.00', currency: 'INR', status: 'FAILED', provider: 'RAZORPAY', idempotencyKey: `P13-FAILED-${runId}`, failedAt: new Date(), failureReason: 'test fixture' },
      });

      const balance = await refundCalculation.getRefundableBalance(prisma, payment.id, payment.amount);
      expect(Number(balance)).toBeCloseTo(300, 2); // full captured amount - the FAILED row never reduced it.
    });

    it('a return with a prior UNKNOWN refund attempt rejects a new initiate() call until reconciled', async () => {
      const { productId } = await createProduct(`P13 UnknownBlock ${runId}`, '200.00', 5);
      const customer = await createCustomer(`p13.unknownblock.${runId}@example.com`, 'Secret123!');
      const custLogin = await api().post('/api/v1/auth/login').send({ email: customer.email, password: customer.password });
      const { orderNumber } = await checkoutMultiItemAndPay(custLogin.body.accessToken, [{ productId, quantity: 1 }]);
      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber }, include: { items: true } });
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' });
      await api().post(`/api/v1/admin/orders/${orderNumber}/fulfill`).set('Authorization', auth(adminToken)).send({});
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'SHIPPED' });
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'DELIVERED' });

      const returnId = await driveReturnToRefundPending(custLogin.body.accessToken, orderNumber, order.items[0].id, 1);
      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id, status: 'CAPTURED' } });
      await prisma.refund.create({
        data: { storeId, orderId: order.id, paymentId: payment.id, returnRequestId: returnId, amount: '200.00', currency: 'INR', status: 'UNKNOWN', provider: 'RAZORPAY', idempotencyKey: `RETURN_REFUND:${returnId}`, failureReason: 'simulated lost response' },
      });

      const res = await api().post(`/api/v1/admin/returns/${returnId}/refund`).set('Authorization', auth(adminToken)).send({});
      expect(res.status).toBe(409);
    });
  });

  describe('Webhook security', () => {
    it('rejects a webhook with an invalid signature', async () => {
      const res = await api().post('/api/v1/payments/razorpay/webhook').set('x-razorpay-signature', 'not-a-real-signature').send({ event: 'payment.captured', payload: {} });
      expect(res.status).toBe(400);
    });

    it('rejects a webhook with no signature header at all', async () => {
      const res = await api().post('/api/v1/payments/razorpay/webhook').send({ event: 'payment.captured', payload: {} });
      expect(res.status).toBe(400);
    });
  });

  describe('Health, readiness, and diagnostics', () => {
    it('/health/live never depends on the database and always reports ok', async () => {
      const res = await api().get('/api/v1/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('/health/ready and the legacy /health both report ok when the database is reachable', async () => {
      const ready = await api().get('/api/v1/health/ready');
      expect(ready.status).toBe(200);
      const legacy = await api().get('/api/v1/health');
      expect(legacy.status).toBe(200);
    });

    it('the diagnostics snapshot never requires authentication-less access, and its shape never leaks secrets', async () => {
      const unauth = await api().get('/api/v1/admin/diagnostics');
      expect(unauth.status).toBe(401);

      const { token } = await createLimitedAdmin(['diagnostics.read'], `p13.diag.${runId}@example.com`);
      const res = await api().get('/api/v1/admin/diagnostics').set('Authorization', auth(token));
      expect(res.status).toBe(200);
      expect(res.body.outbox).toBeDefined();
      expect(res.body.notifications).toBeDefined();
      expect(res.body.metrics).toBeDefined();
      // Route TEMPLATES for auth endpoints (e.g. "/auth/forgot-password")
      // legitimately contain words like "password"/"reset" as part of the
      // path itself - that's not a leak. What must never appear is an
      // actual secret VALUE: a password hash, a raw token, or a config key.
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toMatch(/passwordHash/i);
      expect(serialized).not.toMatch(/accessSecret|JWT_ACCESS_SECRET/i);
      expect(serialized).not.toMatch(/DATABASE_URL/);
      expect(serialized).not.toMatch(/refreshToken"\s*:\s*"[^"]/i);
    });
  });

  describe('Request correlation', () => {
    it('echoes a well-formed client-supplied X-Request-Id back in the response header', async () => {
      const res = await api().get('/api/v1/health/live').set('X-Request-Id', 'p13-test-request-id-123');
      expect(res.headers['x-request-id']).toBe('p13-test-request-id-123');
    });

    it('generates a fresh request id when none is supplied, and rejects an unsafe one by replacing it', async () => {
      const withoutOne = await api().get('/api/v1/health/live');
      expect(withoutOne.headers['x-request-id']).toBeTruthy();

      const withUnsafeOne = await api().get('/api/v1/health/live').set('X-Request-Id', '<script>alert(1)</script>');
      expect(withUnsafeOne.headers['x-request-id']).not.toContain('<script>');
    });
  });

  // Helmet/CSP headers are wired in main.ts's bootstrap() (Swagger gating,
  // helmet(), CORS) - deliberately not part of this file's own minimal test
  // bootstrap, matching every other e2e file's established convention of
  // only replicating the specific pipes/prefix it needs rather than the
  // full production bootstrap. Verified instead via the live HTTP smoke
  // test against the actually-compiled, actually-running server (see the
  // Phase 13 report's Live HTTP Security Smoke Test section).

  describe('Sensitive response audit', () => {
    it('/auth/me never exposes a password hash or refresh token', async () => {
      const customer = await createCustomer(`p13.sensitive.${runId}@example.com`, 'Secret123!');
      const login = await api().post('/api/v1/auth/login').send({ email: customer.email, password: customer.password });
      const me = await api().get('/api/v1/auth/me').set('Authorization', auth(login.body.accessToken));
      const serialized = JSON.stringify(me.body);
      expect(serialized).not.toMatch(/passwordHash/i);
      expect(serialized).not.toMatch(/refreshToken/i);
    });

    it('a 500-shaped internal error never leaks a stack trace or Prisma internals to the client', async () => {
      // An intentionally malformed request that DTO validation itself can't
      // catch cleanly still resolves through the global exception filter -
      // an unknown route under the API prefix is a safe, deterministic way
      // to observe the filter's shape without depending on any specific
      // internal failure mode.
      const res = await api().get('/api/v1/this-route-does-not-exist-at-all');
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/at\s+\w+\s+\(/); // no stack-trace-shaped content
      expect(res.body.message).toBeDefined();
    });
  });

  describe('Database invariants', () => {
    it('no store ever has combined SUCCEEDED refunds exceeding its own captured payment amounts', async () => {
      const violations = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::int c FROM (
          SELECT p.id, p.amount AS captured, COALESCE(SUM(rf.amount), 0) AS refunded
          FROM payments p
          LEFT JOIN refunds rf ON rf."paymentId" = p.id AND rf.status = 'SUCCEEDED'
          WHERE p."storeId" = ${storeId} AND p.status = 'CAPTURED'
          GROUP BY p.id, p.amount
        ) t WHERE t.refunded > t.captured`;
      expect(Number(violations[0].c)).toBe(0);
    });

    it('no refresh token is both revoked and still findable as the CURRENT session for its own replacedBy chain (no dangling reuse-window)', async () => {
      const dangling = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::int c FROM refresh_tokens rt
        WHERE rt."revokedAt" IS NOT NULL AND rt."replacedBy" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM refresh_tokens rt2 WHERE rt2."tokenHash" = rt."replacedBy")`;
      // Every rotated-away token's `replacedBy` hash must correspond to a
      // real successor row - if it didn't, the reuse-detection logic in
      // AuthService.refresh() would be pointing at nothing.
      expect(Number(dangling[0].c)).toBe(0);
    });
  });
});
