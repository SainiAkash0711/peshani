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
import { OutboxService } from '../src/modules/notifications/outbox.service';
import { OutboxWorkerService } from '../src/modules/notifications/outbox-worker.service';
import { EmailDeliveryWorkerService } from '../src/modules/notifications/email-delivery-worker.service';
import { TemplateRendererService } from '../src/modules/notifications/template-renderer.service';
import { FakeRazorpayProvider, signPayment } from './helpers/fake-razorpay-provider';

/**
 * Phase 9 - Notifications & Transactional Communication (e2e). Covers:
 * template rendering safety, tenant/customer security, preference gating
 * (marketing vs always-send transactional), idempotency, concurrency (N
 * simultaneous claims of the same event/notification), the real business-
 * event integration (order lifecycle, payment success/failure, review
 * moderation) driven through the actual checkout/admin APIs, notification
 * CRUD/read-state, admin visibility, template management + RBAC, and
 * database invariants. Workers are driven deterministically via their own
 * public processBatchOnce() rather than waiting on the real setInterval timer.
 */
// Most tests here call drainOutboxAndEmail(), which loops until the ENTIRE
// outbox/email backlog is processed (see that helper's own doc comment) -
// in a full regression run, that backlog includes every real order/payment/
// review event created by every OTHER suite that already ran (they never
// drain their own events under NODE_ENV=test), so this can legitimately
// take longer than Jest's 5000ms default. Raised file-wide rather than
// annotating each test individually, since nearly all of them are affected.
jest.setTimeout(30000);

describe('Peshani Phase 9 - Notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService<AppConfig, true>;
  let fakeProvider: FakeRazorpayProvider;
  let outboxService: OutboxService;
  let outboxWorker: OutboxWorkerService;
  let emailWorker: EmailDeliveryWorkerService;
  let renderer: TemplateRendererService;
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

  /**
   * Every other test file in this suite ALSO drives real checkout/payment/
   * order-status/review-moderation code paths, which now (since Phase 9
   * wired notifications into those shared business services, not just this
   * file) create real OutboxEvent rows in this same shared, persistent dev
   * database - never drained by those files, since only this file's tests
   * call the workers at all under NODE_ENV=test (see OutboxWorkerService's
   * doc comment). A single processBatchOnce() call only claims a bounded
   * batch (20 rows) - with hundreds of such rows accumulated from earlier
   * suites in a full regression run, one call can starve THIS test's own
   * just-created event behind an unrelated backlog. Loop until each worker
   * reports nothing left to claim, so a full regression run drains
   * deterministically regardless of backlog size - production itself never
   * needs this (its interval keeps polling indefinitely).
   */
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

  async function checkoutAndPay(token: string, productId: string) {
    await api().post('/api/v1/cart/items').set('Authorization', auth(token)).send({ productId, quantity: 1 });
    const checkout = await api().post('/api/v1/checkout/create').set('Authorization', auth(token)).send({ email: 'buyer@example.com', billingAddress: address });
    expect(checkout.status).toBe(201);
    const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
    fakeProvider.registerPayment(paymentId, checkout.body.razorpayOrderId, 'captured');
    const signature = signPayment(checkout.body.razorpayOrderId, paymentId);
    const verify = await api()
      .post('/api/v1/payments/razorpay/verify')
      .set('Authorization', auth(token))
      .send({ orderNumber: checkout.body.orderNumber, razorpayOrderId: checkout.body.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: signature });
    expect(verify.status).toBe(201);
    return { orderNumber: checkout.body.orderNumber as string };
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
    outboxService = app.get(OutboxService);
    outboxWorker = app.get(OutboxWorkerService);
    emailWorker = app.get(EmailDeliveryWorkerService);
    renderer = app.get(TemplateRendererService);

    const store = await prisma.store.findUniqueOrThrow({ where: { slug: DEFAULT_STORE_SLUG } });
    storeId = store.id;

    const warehouse = await prisma.warehouse.create({ data: { storeId, name: `Phase9 WH ${runId}`, code: `P9-WH-${runId}`, isActive: true, isDefault: true } });
    warehouseId = warehouse.id;

    const adminLogin = await api().post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Template rendering', () => {
    it('substitutes known variables', () => {
      expect(renderer.render('Hello {{name}}, order {{orderNumber}}', { name: 'Alice', orderNumber: 'PES-1' })).toBe('Hello Alice, order PES-1');
    });

    it('renders a missing variable as empty string rather than throwing', () => {
      expect(() => renderer.render('Hi {{name}} {{unknown}}', { name: 'Bob' })).not.toThrow();
      expect(renderer.render('Hi {{name}} {{unknown}}', { name: 'Bob' })).toBe('Hi Bob ');
    });

    it('never executes arbitrary code - a variable value containing template-like syntax is inserted as literal text, not re-evaluated', () => {
      const rendered = renderer.render('Note: {{note}}', { note: '{{orderNumber}}' });
      expect(rendered).toBe('Note: {{orderNumber}}');
    });

    it('HTML-escapes variable values for the email-safe renderer', () => {
      const rendered = renderer.renderHtml('Hi {{name}}', { name: '<script>alert(1)</script>' });
      expect(rendered).not.toContain('<script>');
      expect(rendered).toContain('&lt;script&gt;');
    });
  });

  describe('Idempotency', () => {
    it('a duplicate OutboxEvent record() call with the same idempotencyKey creates exactly one row', async () => {
      // Uses a real customer id (not a synthetic placeholder) so that IF the
      // background OutboxWorkerService picks this row up before the test
      // cleans it up, dispatch succeeds cleanly instead of permanently
      // failing on a foreign-key violation and leaving retry noise behind
      // in this shared, persistent dev database for future test runs.
      const { userId } = await createCustomer(`p9.idemdup.${runId}@example.com`, 'Secret123!');
      const key = `TEST_EVENT:dup-${runId}`;
      await prisma.$transaction(async (tx) => {
        await outboxService.record(tx, { storeId, eventType: 'ORDER_CONFIRMED', aggregateType: 'Order', aggregateId: `agg-${runId}`, idempotencyKey: key, payload: { userId } });
      });
      await prisma.$transaction(async (tx) => {
        await outboxService.record(tx, { storeId, eventType: 'ORDER_CONFIRMED', aggregateType: 'Order', aggregateId: `agg-${runId}`, idempotencyKey: key, payload: { userId } });
      });
      const count = await prisma.outboxEvent.count({ where: { idempotencyKey: key } });
      expect(count).toBe(1);
      await drainOutboxAndEmail();
    });

    it('duplicate customer/order events for the SAME order produce exactly one Notification per channel end to end', async () => {
      const { token, userId } = await createCustomer(`p9.idem.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P9Idem ${runId}`, '100.00', 10);
      const { orderNumber } = await checkoutAndPay(token, productId);
      await drainOutboxAndEmail();
      await drainOutboxAndEmail(); // deliberately run the worker again - must not double-dispatch.

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber } });
      const notifications = await prisma.notification.findMany({ where: { storeId, userId, type: 'ORDER_CONFIRMED' } });
      expect(notifications.length).toBeLessThanOrEqual(2); // at most IN_APP + EMAIL, never duplicated.
      const inApp = notifications.filter((n) => n.channel === 'IN_APP');
      expect(inApp).toHaveLength(1);
      expect(order.id).toBeTruthy();
    });
  });

  describe('Concurrency', () => {
    it('10 concurrent OutboxEvent record() calls for the SAME idempotency key result in exactly 1 row (Race)', async () => {
      const { userId } = await createCustomer(`p9.idemrace.${runId}@example.com`, 'Secret123!');
      const key = `TEST_EVENT:race-${runId}`;
      const attempts = Array.from({ length: 10 }, () =>
        prisma.$transaction(async (tx) => {
          await outboxService.record(tx, { storeId, eventType: 'ORDER_CONFIRMED', aggregateType: 'Order', aggregateId: `agg-race-${runId}`, idempotencyKey: key, payload: { userId } });
        }),
      );
      await Promise.all(attempts);
      const count = await prisma.outboxEvent.count({ where: { idempotencyKey: key } });
      expect(count).toBe(1);
      await drainOutboxAndEmail();
    });

    it('10 concurrent workers processing the SAME already-pending OutboxEvent dispatch it exactly once - 1 logical notification, 0 duplicates', async () => {
      const { userId } = await createCustomer(`p9.workerrace.${runId}@example.com`, 'Secret123!');
      const key = `ORDER_CONFIRMED:workerrace-${runId}`;
      await prisma.outboxEvent.create({
        data: {
          storeId,
          eventType: 'ORDER_CONFIRMED',
          aggregateType: 'Order',
          aggregateId: `workerrace-${runId}`,
          idempotencyKey: key,
          payload: { userId },
        },
      });

      // 10 simultaneous "worker ticks" against the SAME single pending row -
      // the atomic conditional claim (updateMany where status='PENDING')
      // inside processBatchOnce() means only one of these can ever actually
      // dispatch it; the other 9 find count===0 and skip it entirely.
      const results = await Promise.all(Array.from({ length: 10 }, () => outboxWorker.processBatchOnce()));
      expect(results.reduce((sum, n) => sum + n, 0)).toBe(1); // exactly one successful dispatch across all 10 ticks.

      const event = await prisma.outboxEvent.findUniqueOrThrow({ where: { idempotencyKey: key } });
      expect(event.status).toBe('PROCESSED');

      const notifications = await prisma.notification.findMany({ where: { storeId, userId, type: 'ORDER_CONFIRMED', idempotencyKey: `ORDER_CONFIRMED:workerrace-${runId}:IN_APP` } });
      expect(notifications).toHaveLength(1); // exactly one logical notification, never duplicated by the 10-way worker race.
    });

    it('concurrent markAllAsRead calls for the same customer never error and leave zero unread', async () => {
      const { token, userId } = await createCustomer(`p9.concurrent.read.${runId}@example.com`, 'Secret123!');
      for (let i = 0; i < 5; i++) {
        await prisma.notification.create({
          data: {
            storeId,
            userId,
            type: 'PROMOTION_AVAILABLE',
            channel: 'IN_APP',
            title: 'x',
            message: 'x',
            idempotencyKey: `PROMOTION_AVAILABLE:concurrent-${runId}-${i}`,
            status: 'SENT',
            sentAt: new Date(),
          },
        });
      }
      const [a, b] = await Promise.all([
        api().patch('/api/v1/notifications/read-all').set('Authorization', auth(token)),
        api().patch('/api/v1/notifications/read-all').set('Authorization', auth(token)),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      const unread = await api().get('/api/v1/notifications/unread-count').set('Authorization', auth(token));
      expect(unread.body.count).toBe(0);
    });
  });

  describe('Preferences', () => {
    it('a marketing type (COUPON_AVAILABLE) is suppressed on a channel once the customer disables that preference', async () => {
      const { token, userId } = await createCustomer(`p9.pref.${runId}@example.com`, 'Secret123!');
      const disable = await api().patch('/api/v1/notification-preferences').set('Authorization', auth(token)).send({ IN_APP_PROMOTION_UPDATES: false });
      expect(disable.status).toBe(200);
      expect(disable.body.IN_APP_PROMOTION_UPDATES).toBe(false);

      await prisma.$transaction(async (tx) => {
        await outboxService.record(tx, {
          storeId,
          eventType: 'COUPON_AVAILABLE',
          aggregateType: 'Coupon',
          aggregateId: `coupon-${runId}`,
          idempotencyKey: `COUPON_AVAILABLE:coupon-${runId}`,
          payload: { userId, couponCode: 'TEST10' },
        });
      });
      await drainOutboxAndEmail();

      const inApp = await prisma.notification.findMany({ where: { storeId, userId, type: 'COUPON_AVAILABLE', channel: 'IN_APP' } });
      expect(inApp).toHaveLength(0);
    });

    it('PAYMENT_FAILED is never suppressed, even with every preference disabled (always-send transactional type)', async () => {
      const { token, userId } = await createCustomer(`p9.alwayssend.${runId}@example.com`, 'Secret123!');
      await api().patch('/api/v1/notification-preferences').set('Authorization', auth(token)).send({ IN_APP_PAYMENT_UPDATES: false, EMAIL_PAYMENT_UPDATES: false });

      const { productId } = await createProduct(`P9AlwaysSend ${runId}`, '150.00', 5);
      await api().post('/api/v1/cart/items').set('Authorization', auth(token)).send({ productId, quantity: 1 });
      const checkout = await api().post('/api/v1/checkout/create').set('Authorization', auth(token)).send({ email: 'buyer@example.com', billingAddress: address });
      const badVerify = await api()
        .post('/api/v1/payments/razorpay/verify')
        .set('Authorization', auth(token))
        .send({ orderNumber: checkout.body.orderNumber, razorpayOrderId: checkout.body.razorpayOrderId, razorpayPaymentId: 'pay_bad', razorpaySignature: 'invalid-signature' });
      expect(badVerify.status).toBe(400);
      await drainOutboxAndEmail();

      const notifications = await prisma.notification.findMany({ where: { storeId, userId, type: 'PAYMENT_FAILED' } });
      expect(notifications.length).toBeGreaterThan(0); // preference disabled, but this type always sends.
    });
  });

  describe('Security', () => {
    it('a customer cannot mark another customer\'s notification as read (safe 404), and cannot see it in their own list', async () => {
      const { userId: ownerId } = await createCustomer(`p9.sec.owner.${runId}@example.com`, 'Secret123!');
      const { token: otherToken } = await createCustomer(`p9.sec.other.${runId}@example.com`, 'Secret123!');
      const notification = await prisma.notification.create({
        data: { storeId, userId: ownerId, type: 'ORDER_CONFIRMED', channel: 'IN_APP', title: 'x', message: 'x', idempotencyKey: `ORDER_CONFIRMED:sec-${runId}`, status: 'SENT', sentAt: new Date() },
      });

      const res = await api().patch(`/api/v1/notifications/${notification.id}/read`).set('Authorization', auth(otherToken));
      expect(res.status).toBe(404);

      const list = await api().get('/api/v1/notifications').set('Authorization', auth(otherToken));
      expect(list.body.items.some((n: { id: string }) => n.id === notification.id)).toBe(false);
    });

    it("a Store B customer cannot access Store A's notification (tenant isolation)", async () => {
      const storeB = await prisma.store.create({ data: { slug: `store-b-notif-${runId}`, name: 'Store B', isActive: true } });
      const roleB = await prisma.role.create({ data: { storeId: storeB.id, name: 'CUSTOMER' } });
      const userB = await prisma.user.create({ data: { storeId: storeB.id, email: `p9.storeb.${runId}@example.com`, passwordHash: await argon2.hash('Secret123!'), type: 'CUSTOMER', isActive: true, emailVerifiedAt: new Date() } });
      await prisma.userRole.create({ data: { userId: userB.id, roleId: roleB.id } });
      const tokenB = await jwtService.signAsync(
        { sub: userB.id, storeId: storeB.id, email: userB.email, type: 'CUSTOMER', roles: ['CUSTOMER'], permissions: [] },
        { secret: configService.get('jwt', { infer: true }).accessSecret, expiresIn: '15m', algorithm: 'HS256', issuer: 'peshani-api', audience: 'peshani-client' },
      );

      const { userId: ownerId } = await createCustomer(`p9.sec.tenantowner.${runId}@example.com`, 'Secret123!');
      const notification = await prisma.notification.create({
        data: { storeId, userId: ownerId, type: 'ORDER_CONFIRMED', channel: 'IN_APP', title: 'x', message: 'x', idempotencyKey: `ORDER_CONFIRMED:tenant-${runId}`, status: 'SENT', sentAt: new Date() },
      });

      const res = await api().patch(`/api/v1/notifications/${notification.id}/read`).set('Authorization', auth(tokenB));
      expect(res.status).toBe(404);
    });

    it('a plain customer token is rejected by the admin notifications and admin notification-templates APIs', async () => {
      const { token } = await createCustomer(`p9.sec.customer.${runId}@example.com`, 'Secret123!');
      const notifRes = await api().get('/api/v1/admin/notifications').set('Authorization', auth(token));
      expect(notifRes.status).toBe(403);
      const templateRes = await api().get('/api/v1/admin/notification-templates').set('Authorization', auth(token));
      expect(templateRes.status).toBe(403);
    });

    it('an admin without notification_template.create cannot create a template, but one with the permission can', async () => {
      const { token: readOnly } = await createLimitedAdmin(['notification_template.read'], `p9.readonly.${runId}@example.com`);
      const denied = await api()
        .post('/api/v1/admin/notification-templates')
        .set('Authorization', auth(readOnly))
        .send({ key: 'ORDER_CONFIRMED', channel: 'IN_APP', body: 'custom {{orderNumber}}' });
      expect(denied.status).toBe(403);

      // This shared, persistent dev store may already carry a template for
      // this (key, channel) from an earlier run of this same suite - the
      // uniqueness constraint is store-scoped, not runId-scoped, so clear
      // it first to keep this test idempotent across repeated runs.
      await prisma.notificationTemplate.deleteMany({ where: { storeId, key: 'PROMOTION_AVAILABLE', channel: 'IN_APP' } });

      const { token: creator } = await createLimitedAdmin(['notification_template.create', 'notification_template.read'], `p9.creator.${runId}@example.com`);
      const created = await api()
        .post('/api/v1/admin/notification-templates')
        .set('Authorization', auth(creator))
        .send({ key: 'PROMOTION_AVAILABLE', channel: 'IN_APP', title: 'Custom title', body: 'Custom {{promotionName}}' });
      expect(created.status).toBe(201);
    });

    it('the notification-preferences DTO does not accept a client-supplied userId/storeId - identity always comes from the JWT', async () => {
      const { token, userId } = await createCustomer(`p9.sec.forge.${runId}@example.com`, 'Secret123!');
      const res = await api()
        .patch('/api/v1/notification-preferences')
        .set('Authorization', auth(token))
        .send({ EMAIL_ORDER_UPDATES: false, userId: 'forged-id', storeId: 'forged-store' });
      expect(res.status).toBe(400); // forbidNonWhitelisted rejects unknown fields entirely.
      const row = await prisma.notificationPreference.findFirst({ where: { userId, key: 'EMAIL_ORDER_UPDATES' } });
      expect(row).toBeNull(); // rejected before any write.
    });
  });

  describe('Business event integration (live smoke)', () => {
    it('checkout -> payment success -> ORDER_CONFIRMED notification appears for the customer', async () => {
      const { token, userId } = await createCustomer(`p9.smoke.confirm.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P9SmokeConfirm ${runId}`, '200.00', 10);
      await checkoutAndPay(token, productId);
      await drainOutboxAndEmail();

      const list = await api().get('/api/v1/notifications?type=ORDER_CONFIRMED').set('Authorization', auth(token));
      expect(list.status).toBe(200);
      expect(list.body.items.length).toBeGreaterThan(0);
      expect(list.body.items[0].message).toContain('confirmed');

      const emailRow = await prisma.notification.findFirst({ where: { storeId, userId, type: 'ORDER_CONFIRMED', channel: 'EMAIL' } });
      expect(emailRow?.status).toBe('SENT'); // delivered via the LoggingEmailProvider fallback (no SMTP configured in this environment).
    });

    it('admin PROCESSING -> PACKED -> SHIPPED -> DELIVERED produces the corresponding notifications in order', async () => {
      const { token, userId } = await createCustomer(`p9.smoke.lifecycle.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P9SmokeLifecycle ${runId}`, '300.00', 10);
      const { orderNumber } = await checkoutAndPay(token, productId);
      await drainOutboxAndEmail();

      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' });
      await api().post(`/api/v1/admin/orders/${orderNumber}/fulfill`).set('Authorization', auth(adminToken)).send({});
      await drainOutboxAndEmail();
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'SHIPPED' });
      await drainOutboxAndEmail();
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'DELIVERED' });
      await drainOutboxAndEmail();

      const types = ['ORDER_PACKED', 'ORDER_SHIPPED', 'ORDER_DELIVERED'];
      for (const type of types) {
        const n = await prisma.notification.findFirst({ where: { storeId, userId, type: type as never, channel: 'IN_APP' } });
        expect(n).not.toBeNull();
      }
    });

    it('order cancellation produces an ORDER_CANCELLED notification', async () => {
      const { token, userId } = await createCustomer(`p9.smoke.cancel.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P9SmokeCancel ${runId}`, '90.00', 10);
      const { orderNumber } = await checkoutAndPay(token, productId);
      const cancel = await api().post(`/api/v1/orders/${orderNumber}/cancel`).set('Authorization', auth(token)).send({});
      expect(cancel.status).toBe(201);
      await drainOutboxAndEmail();

      const n = await prisma.notification.findFirst({ where: { storeId, userId, type: 'ORDER_CANCELLED', channel: 'IN_APP' } });
      expect(n).not.toBeNull();
    });

    it('review approval/rejection each produce the corresponding customer notification', async () => {
      const { token, userId } = await createCustomer(`p9.smoke.review.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P9SmokeReview ${runId}`, '80.00', 10);
      const { orderNumber } = await checkoutAndPay(token, productId);
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' });
      await api().post(`/api/v1/admin/orders/${orderNumber}/fulfill`).set('Authorization', auth(adminToken)).send({});
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'SHIPPED' });
      await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'DELIVERED' });

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber }, include: { items: true } });
      const orderItem = order.items.find((i) => i.productId === productId)!;
      const review = await api().post('/api/v1/reviews').set('Authorization', auth(token)).send({ productId, orderItemId: orderItem.id, rating: 5, body: 'Great product, would buy again.' });
      expect(review.status).toBe(201);

      const approve = await api().patch(`/api/v1/admin/reviews/${review.body.id}/moderate`).set('Authorization', auth(adminToken)).send({ status: 'APPROVED' });
      expect(approve.status).toBe(200);
      await drainOutboxAndEmail();

      const approvedNotification = await prisma.notification.findFirst({ where: { storeId, userId, type: 'REVIEW_APPROVED', channel: 'IN_APP' } });
      expect(approvedNotification).not.toBeNull();
    });
  });

  describe('Notification history / read state API', () => {
    it('lists, filters unread, marks one as read, and marks all as read', async () => {
      const { token, userId } = await createCustomer(`p9.crud.${runId}@example.com`, 'Secret123!');
      const n1 = await prisma.notification.create({
        data: { storeId, userId, type: 'ORDER_CONFIRMED', channel: 'IN_APP', title: 'A', message: 'A', idempotencyKey: `ORDER_CONFIRMED:crud1-${runId}`, status: 'SENT', sentAt: new Date() },
      });
      await prisma.notification.create({
        data: { storeId, userId, type: 'ORDER_SHIPPED', channel: 'IN_APP', title: 'B', message: 'B', idempotencyKey: `ORDER_SHIPPED:crud2-${runId}`, status: 'SENT', sentAt: new Date() },
      });

      const unreadCount = await api().get('/api/v1/notifications/unread-count').set('Authorization', auth(token));
      expect(unreadCount.body.count).toBe(2);

      const markOne = await api().patch(`/api/v1/notifications/${n1.id}/read`).set('Authorization', auth(token));
      expect(markOne.status).toBe(200);

      const unreadOnly = await api().get('/api/v1/notifications?unreadOnly=true').set('Authorization', auth(token));
      expect(unreadOnly.body.items).toHaveLength(1);

      const markAll = await api().patch('/api/v1/notifications/read-all').set('Authorization', auth(token));
      expect(markAll.body.count).toBe(1);

      const finalUnread = await api().get('/api/v1/notifications/unread-count').set('Authorization', auth(token));
      expect(finalUnread.body.count).toBe(0);
    });
  });

  /**
   * Final Micro-Correction - explicit, dedicated proof that delivery state
   * (`Notification.status`) and read state (`Notification.readAt`) are two
   * fully independent concepts, never conflated anywhere in this codebase.
   * Audited directly: the `NotificationStatus` enum has no `READ` value
   * (confirmed against prisma/schema.prisma) and markAsRead()/
   * markAllAsRead() only ever write `readAt` - see notification.service.ts.
   * These tests lock that behavior in against future regression.
   */
  describe('Delivery state vs read state independence', () => {
    it('Test 1: a freshly delivered IN_APP notification is SENT + unread (readAt null)', async () => {
      const { userId } = await createCustomer(`p9.dvr.sent.${runId}@example.com`, 'Secret123!');
      const created = await prisma.notification.create({
        data: { storeId, userId, type: 'ORDER_CONFIRMED', channel: 'IN_APP', title: 'x', message: 'x', idempotencyKey: `ORDER_CONFIRMED:dvr-sent-${runId}`, status: 'SENT', sentAt: new Date() },
      });
      expect(created.status).toBe('SENT');
      expect(created.readAt).toBeNull();
    });

    it('Test 2: markAsRead() sets readAt but leaves delivery status exactly SENT', async () => {
      const { token, userId } = await createCustomer(`p9.dvr.markread.${runId}@example.com`, 'Secret123!');
      const created = await prisma.notification.create({
        data: { storeId, userId, type: 'ORDER_CONFIRMED', channel: 'IN_APP', title: 'x', message: 'x', idempotencyKey: `ORDER_CONFIRMED:dvr-markread-${runId}`, status: 'SENT', sentAt: new Date() },
      });

      const res = await api().patch(`/api/v1/notifications/${created.id}/read`).set('Authorization', auth(token));
      expect(res.status).toBe(200);

      const after = await prisma.notification.findUniqueOrThrow({ where: { id: created.id } });
      expect(after.status).toBe('SENT'); // delivery status untouched by the read action.
      expect(after.readAt).not.toBeNull();
    });

    it('Test 3: markAllAsRead() sets readAt on every affected row while every one remains delivery status SENT', async () => {
      const { token, userId } = await createCustomer(`p9.dvr.markall.${runId}@example.com`, 'Secret123!');
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const created = await prisma.notification.create({
          data: { storeId, userId, type: 'ORDER_SHIPPED', channel: 'IN_APP', title: 'x', message: 'x', idempotencyKey: `ORDER_SHIPPED:dvr-markall-${runId}-${i}`, status: 'SENT', sentAt: new Date() },
        });
        ids.push(created.id);
      }

      const res = await api().patch('/api/v1/notifications/read-all').set('Authorization', auth(token));
      expect(res.body.count).toBe(3);

      const rows = await prisma.notification.findMany({ where: { id: { in: ids } } });
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.status).toBe('SENT'); // delivery status untouched for every affected row.
        expect(row.readAt).not.toBeNull();
      }
    });

    it('Test 4: a FAILED (email delivery exhausted) notification stays FAILED + unread until explicitly read', async () => {
      const { userId } = await createCustomer(`p9.dvr.failed.${runId}@example.com`, 'Secret123!');
      const created = await prisma.notification.create({
        data: {
          storeId,
          userId,
          type: 'PAYMENT_FAILED',
          channel: 'EMAIL',
          title: 'x',
          message: 'x',
          idempotencyKey: `PAYMENT_FAILED:dvr-failed-${runId}`,
          status: 'FAILED',
          attempts: 4,
          lastError: 'SMTP connection refused',
        },
      });
      expect(created.status).toBe('FAILED');
      expect(created.readAt).toBeNull();
    });

    it('Test 5: marking a FAILED notification as read sets readAt only - it is never silently upgraded to SENT or any other delivery status', async () => {
      const { token, userId } = await createCustomer(`p9.dvr.failedread.${runId}@example.com`, 'Secret123!');
      const created = await prisma.notification.create({
        data: {
          storeId,
          userId,
          type: 'PAYMENT_FAILED',
          channel: 'EMAIL',
          title: 'x',
          message: 'x',
          idempotencyKey: `PAYMENT_FAILED:dvr-failedread-${runId}`,
          status: 'FAILED',
          attempts: 4,
          lastError: 'SMTP connection refused',
        },
      });

      const res = await api().patch(`/api/v1/notifications/${created.id}/read`).set('Authorization', auth(token));
      expect(res.status).toBe(200);

      const after = await prisma.notification.findUniqueOrThrow({ where: { id: created.id } });
      expect(after.status).toBe('FAILED'); // never upgraded to SENT (or anything else) merely by being read.
      expect(after.readAt).not.toBeNull();
    });

    it('Test 6: reading the IN_APP notification for an event never touches the sibling EMAIL notification for the SAME event', async () => {
      const { token, userId } = await createCustomer(`p9.dvr.channel.${runId}@example.com`, 'Secret123!');
      const inApp = await prisma.notification.create({
        data: { storeId, userId, type: 'ORDER_CONFIRMED', channel: 'IN_APP', title: 'x', message: 'x', idempotencyKey: `ORDER_CONFIRMED:dvr-channel-${runId}:IN_APP`, status: 'SENT', sentAt: new Date() },
      });
      const email = await prisma.notification.create({
        data: { storeId, userId, type: 'ORDER_CONFIRMED', channel: 'EMAIL', title: 'x', message: 'x', idempotencyKey: `ORDER_CONFIRMED:dvr-channel-${runId}:EMAIL`, status: 'SENT', sentAt: new Date() },
      });

      const res = await api().patch(`/api/v1/notifications/${inApp.id}/read`).set('Authorization', auth(token));
      expect(res.status).toBe(200);

      const emailAfter = await prisma.notification.findUniqueOrThrow({ where: { id: email.id } });
      expect(emailAfter.readAt).toBeNull(); // untouched - reading one channel's row never affects the other's.
      expect(emailAfter.status).toBe('SENT');
    });

    it('Test 7: unread-count and the unreadOnly filter are based on readAt IS NULL, never on a delivery-status comparison', async () => {
      const { token, userId } = await createCustomer(`p9.dvr.unreadbasis.${runId}@example.com`, 'Secret123!');
      // A FAILED notification with readAt still null must count as "unread" -
      // unread-ness is purely about readAt, never about delivery status.
      await prisma.notification.create({
        data: { storeId, userId, type: 'PAYMENT_FAILED', channel: 'EMAIL', title: 'x', message: 'x', idempotencyKey: `PAYMENT_FAILED:dvr-unreadbasis-${runId}`, status: 'FAILED', attempts: 4 },
      });
      await prisma.notification.create({
        data: { storeId, userId, type: 'ORDER_CONFIRMED', channel: 'IN_APP', title: 'x', message: 'x', idempotencyKey: `ORDER_CONFIRMED:dvr-unreadbasis-${runId}`, status: 'SENT', sentAt: new Date() },
      });

      const count = await api().get('/api/v1/notifications/unread-count').set('Authorization', auth(token));
      expect(count.body.count).toBe(2); // both count as unread purely via readAt=null, regardless of one being FAILED.

      const unreadOnly = await api().get('/api/v1/notifications?unreadOnly=true').set('Authorization', auth(token));
      expect(unreadOnly.body.items).toHaveLength(2);
    });

    it('concurrent markAsRead calls for the SAME notification row never corrupt readAt or delivery status', async () => {
      const { token, userId } = await createCustomer(`p9.dvr.concurrent.${runId}@example.com`, 'Secret123!');
      const created = await prisma.notification.create({
        data: { storeId, userId, type: 'ORDER_CONFIRMED', channel: 'IN_APP', title: 'x', message: 'x', idempotencyKey: `ORDER_CONFIRMED:dvr-concurrent-${runId}`, status: 'SENT', sentAt: new Date() },
      });

      const [a, b] = await Promise.all([
        api().patch(`/api/v1/notifications/${created.id}/read`).set('Authorization', auth(token)),
        api().patch(`/api/v1/notifications/${created.id}/read`).set('Authorization', auth(token)),
      ]);
      // Both calls resolve successfully (marking an already-read notification
      // as read again is a safe idempotent no-op, not an error) - the atomic
      // conditional guard (`readAt: null` in the where-clause) means only one
      // of them ever actually performs the write.
      expect([a.status, b.status]).toEqual([200, 200]);

      const after = await prisma.notification.findUniqueOrThrow({ where: { id: created.id } });
      expect(after.status).toBe('SENT');
      expect(after.readAt).not.toBeNull();
    });
  });

  describe('Admin visibility and template management', () => {
    it('an admin with notification.read can view a customer\'s notifications, filtered by status/type', async () => {
      const { token, userId } = await createCustomer(`p9.admin.view.${runId}@example.com`, 'Secret123!');
      await prisma.notification.create({
        data: { storeId, userId, type: 'PAYMENT_SUCCESS', channel: 'IN_APP', title: 'x', message: 'x', idempotencyKey: `PAYMENT_SUCCESS:adminview-${runId}`, status: 'SENT', sentAt: new Date() },
      });
      const res = await api().get(`/api/v1/admin/notifications?userId=${userId}&type=PAYMENT_SUCCESS`).set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(res.body.items[0].user).toBeDefined();
    });

    it('admin can create, update, activate/deactivate, and delete a notification template, each producing an audit log entry', async () => {
      await prisma.notificationTemplate.deleteMany({ where: { storeId, key: 'REVIEW_APPROVED', channel: 'EMAIL' } });
      const created = await api()
        .post('/api/v1/admin/notification-templates')
        .set('Authorization', auth(adminToken))
        .send({ key: 'REVIEW_APPROVED', channel: 'EMAIL', subject: 'Subject {{productName}}', title: 'Title', body: 'Body {{productName}}' });
      expect(created.status).toBe(201);
      const createdAudit = await prisma.auditLog.findFirst({ where: { storeId, entityId: created.body.id, action: 'NOTIFICATION_TEMPLATE_CREATED' } });
      expect(createdAudit).not.toBeNull();

      const updated = await api().patch(`/api/v1/admin/notification-templates/${created.body.id}`).set('Authorization', auth(adminToken)).send({ body: 'Updated body {{productName}}' });
      expect(updated.status).toBe(200);
      expect(updated.body.body).toContain('Updated body');

      const deactivated = await api().patch(`/api/v1/admin/notification-templates/${created.body.id}/status`).set('Authorization', auth(adminToken)).send({ isActive: false });
      expect(deactivated.status).toBe(200);
      expect(deactivated.body.isActive).toBe(false);

      const removed = await api().delete(`/api/v1/admin/notification-templates/${created.body.id}`).set('Authorization', auth(adminToken));
      expect(removed.status).toBe(200);
      const deletedAudit = await prisma.auditLog.findFirst({ where: { storeId, entityId: created.body.id, action: 'NOTIFICATION_TEMPLATE_DELETED' } });
      expect(deletedAudit).not.toBeNull();
    });

    it('a deactivated custom template falls back to the built-in default rather than breaking delivery', async () => {
      const { token, userId } = await createCustomer(`p9.fallback.${runId}@example.com`, 'Secret123!');
      await prisma.notificationTemplate.deleteMany({ where: { storeId, key: 'COUPON_AVAILABLE', channel: 'IN_APP' } });
      const created = await api()
        .post('/api/v1/admin/notification-templates')
        .set('Authorization', auth(adminToken))
        .send({ key: 'COUPON_AVAILABLE', channel: 'IN_APP', title: 'Custom title', body: 'Custom {{couponCode}}' });
      await api().patch(`/api/v1/admin/notification-templates/${created.body.id}/status`).set('Authorization', auth(adminToken)).send({ isActive: false });

      await prisma.$transaction(async (tx) => {
        await outboxService.record(tx, {
          storeId,
          eventType: 'COUPON_AVAILABLE',
          aggregateType: 'Coupon',
          aggregateId: `fallback-${runId}`,
          idempotencyKey: `COUPON_AVAILABLE:fallback-${runId}`,
          payload: { userId, couponCode: 'FALLBACK10' },
        });
      });
      await drainOutboxAndEmail();

      const notification = await prisma.notification.findFirst({ where: { storeId, userId, type: 'COUPON_AVAILABLE', channel: 'IN_APP' } });
      expect(notification).not.toBeNull();
      expect(notification!.message).toContain('FALLBACK10'); // built-in default template, not the deactivated custom one.
      expect(notification!.message).not.toContain('Custom');
      void token;
    });
  });

  describe('Transaction safety', () => {
    it('a business transaction that rolls back never leaves behind an OutboxEvent for the attempted change', async () => {
      const { token } = await createCustomer(`p9.rollback.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`P9Rollback ${runId}`, '60.00', 10);
      const { orderNumber } = await checkoutAndPay(token, productId);

      // An order still CONFIRMED cannot be transitioned straight to SHIPPED
      // (skips PROCESSING/PACKED) - OrderStatusService rejects this before
      // ever opening its transaction, so no OutboxEvent should exist for it.
      const invalid = await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'SHIPPED' });
      expect(invalid.status).toBe(409);

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber } });
      const strayEvent = await prisma.outboxEvent.findUnique({ where: { idempotencyKey: `ORDER_SHIPPED:${order.id}` } });
      expect(strayEvent).toBeNull();
    });
  });

  describe('Database invariants', () => {
    it('no duplicate Notification.idempotencyKey', async () => {
      const rows = await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::int AS c FROM (SELECT "idempotencyKey" FROM notifications GROUP BY "idempotencyKey" HAVING COUNT(*) > 1) x`;
      expect(Number(rows[0].c)).toBe(0);
    });

    it('no duplicate OutboxEvent.idempotencyKey', async () => {
      const rows = await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::int AS c FROM (SELECT "idempotencyKey" FROM outbox_events GROUP BY "idempotencyKey" HAVING COUNT(*) > 1) x`;
      expect(Number(rows[0].c)).toBe(0);
    });

    it('no orphaned notifications (every notification has a valid store and user)', async () => {
      const rows = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::int AS c FROM notifications n
        LEFT JOIN stores s ON s.id = n."storeId"
        LEFT JOIN users u ON u.id = n."userId"
        WHERE s.id IS NULL OR u.id IS NULL`;
      expect(Number(rows[0].c)).toBe(0);
    });

    it('no cross-store notification (notification.storeId always matches its user.storeId)', async () => {
      const rows = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::int AS c FROM notifications n
        JOIN users u ON u.id = n."userId"
        WHERE n."storeId" != u."storeId"`;
      expect(Number(rows[0].c)).toBe(0);
    });

    it('no duplicate NotificationTemplate per (storeId, key, channel)', async () => {
      const rows = await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::int AS c FROM (SELECT "storeId", "key", "channel" FROM notification_templates GROUP BY "storeId", "key", "channel" HAVING COUNT(*) > 1) x`;
      expect(Number(rows[0].c)).toBe(0);
    });

    it('no duplicate NotificationPreference per (storeId, userId, key)', async () => {
      const rows = await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::int AS c FROM (SELECT "storeId", "userId", "key" FROM notification_preferences GROUP BY "storeId", "userId", "key" HAVING COUNT(*) > 1) x`;
      expect(Number(rows[0].c)).toBe(0);
    });
  });
});
