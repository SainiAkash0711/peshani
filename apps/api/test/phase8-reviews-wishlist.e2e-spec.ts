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
 * Phase 8 - Product Reviews & Ratings + Wishlist (e2e). Covers: verified-
 * purchase eligibility (reusing the real Phase 5/6 order lifecycle through
 * to DELIVERED), review CRUD/moderation/public visibility/rating
 * aggregation, helpful voting, reporting, wishlist CRUD/move-to-cart, and
 * the required security/concurrency/invariant checks.
 */
describe('Peshani Phase 8 - Reviews & Wishlist (e2e)', () => {
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

  /** Drives a real order all the way to DELIVERED through the actual Phase 5/6 pipeline - the only path to a reviewable OrderItem in this design. */
  async function checkoutToDelivered(token: string, productId: string, quantity = 1) {
    await addToCart(token, productId, quantity);
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

    const orderNumber = checkout.body.orderNumber as string;
    await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'PROCESSING' });
    await api().post(`/api/v1/admin/orders/${orderNumber}/fulfill`).set('Authorization', auth(adminToken)).send({});
    await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'SHIPPED' });
    const delivered = await api().patch(`/api/v1/admin/orders/${orderNumber}/status`).set('Authorization', auth(adminToken)).send({ status: 'DELIVERED' });
    expect(delivered.status).toBe(200);
    expect(delivered.body.status).toBe('DELIVERED');

    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber }, include: { items: true } });
    const orderItem = order.items.find((i) => i.productId === productId)!;
    return { orderNumber, orderId: order.id, orderItemId: orderItem.id };
  }

  async function createReview(token: string, body: Record<string, unknown>) {
    return api().post('/api/v1/reviews').set('Authorization', auth(token)).send(body);
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

    const warehouse = await prisma.warehouse.create({ data: { storeId, name: `Phase8 WH ${runId}`, code: `P8-WH-${runId}`, isActive: true, isDefault: true } });
    warehouseId = warehouse.id;

    const adminLogin = await api().post('/api/v1/auth/login').send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------
  // Review creation - eligibility, validation, uniqueness
  // -------------------------------------------------------------------
  describe('Review creation', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await api().post('/api/v1/reviews').send({ productId: '00000000-0000-0000-0000-000000000000', orderItemId: '00000000-0000-0000-0000-000000000000', rating: 5, body: 'x' });
      expect(res.status).toBe(401);
    });

    it("the REAL customer-facing GET /orders/:orderNumber response exposes a usable orderItemId - not merely obtainable via a direct database query", async () => {
      const { token } = await createCustomer(`review.apicontract.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ReviewApiContract ${runId}`, '500.00', 10);
      const { orderNumber } = await checkoutToDelivered(token, productId);

      const orderDetail = await api().get(`/api/v1/orders/${orderNumber}`).set('Authorization', auth(token));
      expect(orderDetail.status).toBe(200);
      const item = orderDetail.body.items.find((i: { productId: string }) => i.productId === productId);
      expect(item).toBeDefined();
      expect(item.id).toBeTruthy(); // the id a real frontend must submit as orderItemId.

      const review = await createReview(token, { productId, orderItemId: item.id, rating: 5, body: 'Submitted using only the real API response' });
      expect(review.status).toBe(201);
    });

    it('creates a PENDING, verifiedPurchase review once the order has reached DELIVERED', async () => {
      const { token } = await createCustomer(`review.eligible.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ReviewEligible ${runId}`, '500.00', 10);
      const { orderItemId } = await checkoutToDelivered(token, productId);

      const res = await createReview(token, { productId, orderItemId, rating: 5, title: 'Great', body: 'Loved it, exactly as described.' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PENDING');
      expect(res.body.verifiedPurchase).toBe(true);
      expect(res.body.rating).toBe(5);
    });

    it('rejects a review for an order that has not reached DELIVERED yet', async () => {
      const { token } = await createCustomer(`review.notdelivered.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ReviewNotDelivered ${runId}`, '500.00', 10);
      await addToCart(token, productId, 1);
      const checkout = await api().post('/api/v1/checkout/create').set('Authorization', auth(token)).send({ email: 'buyer@example.com', billingAddress: address });
      expect(checkout.status).toBe(201);

      const paymentId = `pay_test_${Math.random().toString(36).slice(2)}`;
      fakeProvider.registerPayment(paymentId, checkout.body.razorpayOrderId, 'captured');
      const signature = signPayment(checkout.body.razorpayOrderId, paymentId);
      await api()
        .post('/api/v1/payments/razorpay/verify')
        .set('Authorization', auth(token))
        .send({ orderNumber: checkout.body.orderNumber, razorpayOrderId: checkout.body.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: signature });

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.body.orderNumber }, include: { items: true } });
      const orderItemId = order.items[0].id;

      const res = await createReview(token, { productId, orderItemId, rating: 4, body: 'Too early to say' });
      expect(res.status).toBe(409);
    });

    it("rejects a review using another customer's order item (safe 404)", async () => {
      const { token: owner } = await createCustomer(`review.ownerA.${runId}@example.com`, 'Secret123!');
      const { token: intruder } = await createCustomer(`review.intruderB.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ReviewIntruder ${runId}`, '500.00', 10);
      const { orderItemId } = await checkoutToDelivered(owner, productId);

      const res = await createReview(intruder, { productId, orderItemId, rating: 5, body: 'Not mine to review' });
      expect(res.status).toBe(404);
    });

    it('rejects a review where the orderItem does not match the given product', async () => {
      const { token } = await createCustomer(`review.mismatch.${runId}@example.com`, 'Secret123!');
      const { productId: productA } = await createProduct(`ReviewMismatchA ${runId}`, '500.00', 10);
      const { productId: productB } = await createProduct(`ReviewMismatchB ${runId}`, '500.00', 10);
      const { orderItemId } = await checkoutToDelivered(token, productA);

      const res = await createReview(token, { productId: productB, orderItemId, rating: 5, body: 'Wrong product id' });
      expect(res.status).toBe(400);
    });

    it('rejects an out-of-range rating', async () => {
      const { token } = await createCustomer(`review.badrating.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ReviewBadRating ${runId}`, '500.00', 10);
      const { orderItemId } = await checkoutToDelivered(token, productId);

      const res = await createReview(token, { productId, orderItemId, rating: 6, body: 'x' });
      expect(res.status).toBe(400);
    });

    it('the client cannot forge verifiedPurchase, userId, storeId, or status - the DTO does not accept them', async () => {
      const { token } = await createCustomer(`review.forge.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ReviewForge ${runId}`, '500.00', 10);
      const { orderItemId } = await checkoutToDelivered(token, productId);

      const res = await createReview(token, {
        productId,
        orderItemId,
        rating: 5,
        body: 'Attempting to forge fields',
        verifiedPurchase: false,
        status: 'APPROVED',
        userId: '00000000-0000-0000-0000-000000000000',
        storeId: '00000000-0000-0000-0000-000000000000',
      });
      expect(res.status).toBe(400); // forbidNonWhitelisted rejects the unknown fields outright.
    });

    it('rejects a duplicate review for the same order item, including under concurrency', async () => {
      const { token } = await createCustomer(`review.duplicate.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ReviewDuplicate ${runId}`, '500.00', 10);
      const { orderItemId } = await checkoutToDelivered(token, productId);

      const first = await createReview(token, { productId, orderItemId, rating: 5, body: 'First review' });
      expect(first.status).toBe(201);
      const second = await createReview(token, { productId, orderItemId, rating: 3, body: 'Trying again' });
      expect(second.status).toBe(409);

      // Concurrent duplicate creation for a DIFFERENT order item, racing
      // the SAME unique constraint mechanism.
      const { productId: productC } = await createProduct(`ReviewDuplicateRace ${runId}`, '500.00', 10);
      const { orderItemId: raceItemId } = await checkoutToDelivered(token, productC);
      const [a, b] = await Promise.all([
        createReview(token, { productId: productC, orderItemId: raceItemId, rating: 5, body: 'Race A' }),
        createReview(token, { productId: productC, orderItemId: raceItemId, rating: 1, body: 'Race B' }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      const count = await prisma.productReview.count({ where: { orderItemId: raceItemId } });
      expect(count).toBe(1);
    });
  });

  // -------------------------------------------------------------------
  // Review editing & deletion
  // -------------------------------------------------------------------
  describe('Review editing and deletion', () => {
    it('lets a customer edit their own review, resetting it to PENDING for re-moderation', async () => {
      const { token } = await createCustomer(`review.edit.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ReviewEdit ${runId}`, '500.00', 10);
      const { orderItemId } = await checkoutToDelivered(token, productId);
      const created = await createReview(token, { productId, orderItemId, rating: 3, body: 'Initial review' });
      expect(created.status).toBe(201);

      await api().patch(`/api/v1/admin/reviews/${created.body.id}/moderate`).set('Authorization', auth(adminToken)).send({ status: 'APPROVED' });

      const updated = await api().patch(`/api/v1/reviews/${created.body.id}`).set('Authorization', auth(token)).send({ rating: 5, body: 'Updated - even better than I thought' });
      expect(updated.status).toBe(200);
      expect(updated.body.status).toBe('PENDING'); // reset - re-moderation required.
      expect(updated.body.rating).toBe(5);
    });

    it("rejects editing another customer's review (safe 404)", async () => {
      const { token: owner } = await createCustomer(`review.editownerA.${runId}@example.com`, 'Secret123!');
      const { token: intruder } = await createCustomer(`review.editintruderB.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ReviewEditIntruder ${runId}`, '500.00', 10);
      const { orderItemId } = await checkoutToDelivered(owner, productId);
      const created = await createReview(owner, { productId, orderItemId, rating: 3, body: 'Owner review' });

      const res = await api().patch(`/api/v1/reviews/${created.body.id}`).set('Authorization', auth(intruder)).send({ rating: 1 });
      expect(res.status).toBe(404);
    });

    it('lets a customer delete their own review; it no longer appears publicly', async () => {
      const { token } = await createCustomer(`review.delete.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ReviewDelete ${runId}`, '500.00', 10);
      const { orderItemId } = await checkoutToDelivered(token, productId);
      const created = await createReview(token, { productId, orderItemId, rating: 5, body: 'Will delete this' });
      await api().patch(`/api/v1/admin/reviews/${created.body.id}/moderate`).set('Authorization', auth(adminToken)).send({ status: 'APPROVED' });

      const del = await api().delete(`/api/v1/reviews/${created.body.id}`).set('Authorization', auth(token));
      expect(del.status).toBe(200);

      const publicList = await api().get(`/api/v1/products/${productId}/reviews`);
      expect(publicList.body.items.some((r: { id: string }) => r.id === created.body.id)).toBe(false);
    });

    it("rejects deleting another customer's review (safe 404)", async () => {
      const { token: owner } = await createCustomer(`review.delownerA.${runId}@example.com`, 'Secret123!');
      const { token: intruder } = await createCustomer(`review.delintruderB.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ReviewDelIntruder ${runId}`, '500.00', 10);
      const { orderItemId } = await checkoutToDelivered(owner, productId);
      const created = await createReview(owner, { productId, orderItemId, rating: 3, body: 'Owner review' });

      const res = await api().delete(`/api/v1/reviews/${created.body.id}`).set('Authorization', auth(intruder));
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // Admin moderation & audit logging
  // -------------------------------------------------------------------
  describe('Admin moderation', () => {
    it('approves, rejects, and hides reviews, each generating the correct audit event', async () => {
      const { token } = await createCustomer(`review.moderate.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ReviewModerate ${runId}`, '500.00', 10);

      const { orderItemId: item1 } = await checkoutToDelivered(token, productId, 1);
      const r1 = await createReview(token, { productId, orderItemId: item1, rating: 5, body: 'Approve me' });

      const approved = await api().patch(`/api/v1/admin/reviews/${r1.body.id}/moderate`).set('Authorization', auth(adminToken)).send({ status: 'APPROVED' });
      expect(approved.status).toBe(200);
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.moderatedByUserId).toBeTruthy();

      const auditApproved = await prisma.auditLog.findFirst({ where: { storeId, entityId: r1.body.id, action: 'REVIEW_APPROVED' } });
      expect(auditApproved).not.toBeNull();

      const { productId: productB } = await createProduct(`ReviewModerateB ${runId}`, '500.00', 10);
      const { orderItemId: item2 } = await checkoutToDelivered(token, productB, 1);
      const r2 = await createReview(token, { productId: productB, orderItemId: item2, rating: 1, body: 'Reject me' });
      const rejected = await api().patch(`/api/v1/admin/reviews/${r2.body.id}/moderate`).set('Authorization', auth(adminToken)).send({ status: 'REJECTED', moderationNote: 'Spam' });
      expect(rejected.body.status).toBe('REJECTED');
      const auditRejected = await prisma.auditLog.findFirst({ where: { storeId, entityId: r2.body.id, action: 'REVIEW_REJECTED' } });
      expect(auditRejected).not.toBeNull();

      const hidden = await api().patch(`/api/v1/admin/reviews/${r1.body.id}/moderate`).set('Authorization', auth(adminToken)).send({ status: 'HIDDEN' });
      expect(hidden.body.status).toBe('HIDDEN');
      const auditHidden = await prisma.auditLog.findFirst({ where: { storeId, entityId: r1.body.id, action: 'REVIEW_HIDDEN' } });
      expect(auditHidden).not.toBeNull();
    });

    it('a read-only admin (review.read only) cannot moderate or delete a review', async () => {
      const { token } = await createCustomer(`review.readonlytest.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ReviewReadOnly ${runId}`, '500.00', 10);
      const { orderItemId } = await checkoutToDelivered(token, productId);
      const created = await createReview(token, { productId, orderItemId, rating: 4, body: 'x' });

      const { token: readOnlyToken } = await createLimitedAdmin(storeId, ['review.read'], `readonly.review.${runId}@example.com`);
      const moderateAttempt = await api().patch(`/api/v1/admin/reviews/${created.body.id}/moderate`).set('Authorization', auth(readOnlyToken)).send({ status: 'APPROVED' });
      expect(moderateAttempt.status).toBe(403);
      const deleteAttempt = await api().delete(`/api/v1/admin/reviews/${created.body.id}`).set('Authorization', auth(readOnlyToken));
      expect(deleteAttempt.status).toBe(403);
    });

    it("Store B's admin cannot moderate Store A's review (tenant isolation)", async () => {
      const { token } = await createCustomer(`review.tenant.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ReviewTenant ${runId}`, '500.00', 10);
      const { orderItemId } = await checkoutToDelivered(token, productId);
      const created = await createReview(token, { productId, orderItemId, rating: 4, body: 'x' });

      const storeB = await prisma.store.create({ data: { slug: `store-b-review-${runId}`, name: 'Store B', isActive: true } });
      const { token: storeBToken } = await createLimitedAdmin(storeB.id, ['review.read', 'review.moderate'], `storeb.review.${runId}@example.com`);

      const res = await api().patch(`/api/v1/admin/reviews/${created.body.id}/moderate`).set('Authorization', auth(storeBToken)).send({ status: 'APPROVED' });
      expect(res.status).toBe(404);
    });

    it("rejects a review for another tenant's product", async () => {
      const storeB = await prisma.store.create({ data: { slug: `store-b-reviewprod-${runId}`, name: 'Store B', isActive: true } });
      const productB = await prisma.product.create({
        data: { storeId: storeB.id, name: 'Store B Product', slug: `storeb-product-${runId}`, sku: `SB-${runId}`, status: 'ACTIVE', productType: 'SIMPLE', basePrice: '100.00' },
      });
      const { token } = await createCustomer(`review.crosstenant.${runId}@example.com`, 'Secret123!');

      const res = await createReview(token, { productId: productB.id, orderItemId: '00000000-0000-0000-0000-000000000000', rating: 5, body: 'Cross tenant attempt' });
      expect(res.status).toBe(404); // product not found in this store, before even checking the order item.
    });
  });

  // -------------------------------------------------------------------
  // Public visibility, rating aggregation, pagination
  // -------------------------------------------------------------------
  describe('Public visibility and rating aggregation', () => {
    it('only APPROVED reviews are publicly visible, and never expose email/moderation notes', async () => {
      const { token } = await createCustomer(`review.public.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ReviewPublic ${runId}`, '500.00', 10);

      const { orderItemId: item1 } = await checkoutToDelivered(token, productId, 1);
      const approved = await createReview(token, { productId, orderItemId: item1, rating: 5, title: 'Great', body: 'Approved review body' });
      await api().patch(`/api/v1/admin/reviews/${approved.body.id}/moderate`).set('Authorization', auth(adminToken)).send({ status: 'APPROVED' });

      const { orderItemId: item2 } = await checkoutToDelivered(token, productId, 1);
      const pending = await createReview(token, { productId, orderItemId: item2, rating: 2, body: 'Still pending review' });

      const publicList = await api().get(`/api/v1/products/${productId}/reviews`);
      expect(publicList.status).toBe(200);
      const ids = publicList.body.items.map((r: { id: string }) => r.id);
      expect(ids).toContain(approved.body.id);
      expect(ids).not.toContain(pending.body.id);

      const approvedItem = publicList.body.items.find((r: { id: string }) => r.id === approved.body.id);
      expect(approvedItem).not.toHaveProperty('email');
      expect(approvedItem).not.toHaveProperty('moderationNote');
      expect(approvedItem).not.toHaveProperty('userId');
      expect(approvedItem.reviewerDisplayName).toBeTruthy();
      expect(approvedItem.verifiedPurchase).toBe(true);
    });

    it(
      'computes an accurate rating summary from approved reviews only, via efficient aggregation',
      async () => {
        const { productId } = await createProduct(`ReviewSummary ${runId}`, '500.00', 100);
        const ratings = [5, 5, 4, 3, 1];
        for (const rating of ratings) {
          const { token } = await createCustomer(`review.summary.${rating}.${Math.random().toString(36).slice(2, 6)}.${runId}@example.com`, 'Secret123!');
          const { orderItemId } = await checkoutToDelivered(token, productId, 1);
          const created = await createReview(token, { productId, orderItemId, rating, body: `Rating ${rating}` });
          await api().patch(`/api/v1/admin/reviews/${created.body.id}/moderate`).set('Authorization', auth(adminToken)).send({ status: 'APPROVED' });
        }
        // One extra, deliberately left PENDING - must not affect the summary.
        const { token: pendingCustomer } = await createCustomer(`review.summary.pending.${runId}@example.com`, 'Secret123!');
        const { orderItemId: pendingItemId } = await checkoutToDelivered(pendingCustomer, productId, 1);
        await createReview(pendingCustomer, { productId, orderItemId: pendingItemId, rating: 1, body: 'Should not count' });

        const summary = await api().get(`/api/v1/products/${productId}/reviews/summary`);
        expect(summary.status).toBe(200);
        expect(summary.body.totalReviews).toBe(5);
        expect(summary.body.averageRating).toBeCloseTo((5 + 5 + 4 + 3 + 1) / 5, 2);
        expect(summary.body.distribution['5']).toBe(2);
        expect(summary.body.distribution['4']).toBe(1);
        expect(summary.body.distribution['3']).toBe(1);
        expect(summary.body.distribution['2']).toBe(0);
        expect(summary.body.distribution['1']).toBe(1);
      },
      // This test drives 6 full checkoutToDelivered() cycles (each ~7
      // sequential HTTP round trips) plus 6 review create/moderate calls -
      // legitimately more real elapsed time than Jest's 5000ms default,
      // especially now that Phase 9 adds one extra outbox-event insert per
      // order/payment transition. Raised per Jest's own recommended
      // practice for a genuinely long-running test - no assertion changed.
      20000,
    );

    it('paginates the public review list', async () => {
      const { productId } = await createProduct(`ReviewPagination ${runId}`, '500.00', 100);
      for (let i = 0; i < 3; i += 1) {
        const { token } = await createCustomer(`review.page.${i}.${runId}@example.com`, 'Secret123!');
        const { orderItemId } = await checkoutToDelivered(token, productId, 1);
        const created = await createReview(token, { productId, orderItemId, rating: 4, body: `Page test ${i}` });
        await api().patch(`/api/v1/admin/reviews/${created.body.id}/moderate`).set('Authorization', auth(adminToken)).send({ status: 'APPROVED' });
      }

      const page1 = await api().get(`/api/v1/products/${productId}/reviews`).query({ page: 1, pageSize: 2 });
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.pagination.total).toBe(3);
      const page2 = await api().get(`/api/v1/products/${productId}/reviews`).query({ page: 2, pageSize: 2 });
      expect(page2.body.items).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------
  // Helpful voting
  // -------------------------------------------------------------------
  describe('Helpful voting', () => {
    async function createApprovedReview(email: string) {
      const { token } = await createCustomer(email, 'Secret123!');
      const { productId } = await createProduct(`HelpfulProduct ${runId} ${Math.random()}`, '500.00', 10);
      const { orderItemId } = await checkoutToDelivered(token, productId);
      const created = await createReview(token, { productId, orderItemId, rating: 5, body: 'Helpful vote target' });
      await api().patch(`/api/v1/admin/reviews/${created.body.id}/moderate`).set('Authorization', auth(adminToken)).send({ status: 'APPROVED' });
      return created.body.id as string;
    }

    it('a repeated vote is idempotent - never double-counted', async () => {
      const reviewId = await createApprovedReview(`helpful.idempotent.${runId}@example.com`);
      const { token: voter } = await createCustomer(`helpful.voter.${runId}@example.com`, 'Secret123!');

      const first = await api().post(`/api/v1/reviews/${reviewId}/helpful`).set('Authorization', auth(voter));
      expect(first.status).toBe(201);
      expect(first.body.helpfulCount).toBe(1);
      const second = await api().post(`/api/v1/reviews/${reviewId}/helpful`).set('Authorization', auth(voter));
      expect(second.status).toBe(201);
      expect(second.body.helpfulCount).toBe(1);

      const count = await prisma.reviewHelpfulVote.count({ where: { reviewId } });
      expect(count).toBe(1);
    });

    it('a concurrent double vote from the same customer is race-safe - exactly one vote recorded', async () => {
      const reviewId = await createApprovedReview(`helpful.race.${runId}@example.com`);
      const { token: voter } = await createCustomer(`helpful.racevoter.${runId}@example.com`, 'Secret123!');

      await Promise.all([
        api().post(`/api/v1/reviews/${reviewId}/helpful`).set('Authorization', auth(voter)),
        api().post(`/api/v1/reviews/${reviewId}/helpful`).set('Authorization', auth(voter)),
      ]);

      const count = await prisma.reviewHelpfulVote.count({ where: { reviewId } });
      expect(count).toBe(1);
    });

    it('removing a vote is idempotent and updates the count', async () => {
      const reviewId = await createApprovedReview(`helpful.remove.${runId}@example.com`);
      const { token: voter } = await createCustomer(`helpful.removevoter.${runId}@example.com`, 'Secret123!');
      await api().post(`/api/v1/reviews/${reviewId}/helpful`).set('Authorization', auth(voter));

      const removed = await api().delete(`/api/v1/reviews/${reviewId}/helpful`).set('Authorization', auth(voter));
      expect(removed.status).toBe(200);
      expect(removed.body.helpfulCount).toBe(0);
      const removedAgain = await api().delete(`/api/v1/reviews/${reviewId}/helpful`).set('Authorization', auth(voter));
      expect(removedAgain.status).toBe(200);
      expect(removedAgain.body.helpfulCount).toBe(0);
    });

    it("a cross-tenant vote is blocked (Store B customer voting on Store A's review)", async () => {
      const reviewId = await createApprovedReview(`helpful.crosstenant.${runId}@example.com`);
      const storeB = await prisma.store.create({ data: { slug: `store-b-helpful-${runId}`, name: 'Store B', isActive: true } });
      const roleB = await prisma.role.findFirst({ where: { storeId: storeB.id, name: 'CUSTOMER' } });
      let roleId = roleB?.id;
      if (!roleId) {
        const created = await prisma.role.create({ data: { storeId: storeB.id, name: 'CUSTOMER' } });
        roleId = created.id;
      }
      const userB = await prisma.user.create({
        data: { storeId: storeB.id, email: `storeb.helpful.${runId}@example.com`, passwordHash: await argon2.hash('Secret123!'), type: 'CUSTOMER', isActive: true, emailVerifiedAt: new Date() },
      });
      await prisma.userRole.create({ data: { userId: userB.id, roleId } });
      const tokenB = await jwtService.signAsync(
        { sub: userB.id, storeId: storeB.id, email: userB.email, type: 'CUSTOMER', roles: ['CUSTOMER'], permissions: [] },
        { secret: configService.get('jwt', { infer: true }).accessSecret, expiresIn: '15m', algorithm: 'HS256', issuer: 'peshani-api', audience: 'peshani-client' },
      );

      const res = await api().post(`/api/v1/reviews/${reviewId}/helpful`).set('Authorization', auth(tokenB));
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------
  describe('Reporting', () => {
    it('prevents a duplicate report from the same customer against the same review', async () => {
      const { token: author } = await createCustomer(`report.author.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`ReportProduct ${runId}`, '500.00', 10);
      const { orderItemId } = await checkoutToDelivered(author, productId);
      const created = await createReview(author, { productId, orderItemId, rating: 1, body: 'Reportable content' });

      const { token: reporter } = await createCustomer(`report.reporter.${runId}@example.com`, 'Secret123!');
      const first = await api().post(`/api/v1/reviews/${created.body.id}/report`).set('Authorization', auth(reporter)).send({ reason: 'Inappropriate language' });
      expect(first.status).toBe(201);
      const second = await api().post(`/api/v1/reviews/${created.body.id}/report`).set('Authorization', auth(reporter)).send({ reason: 'Reporting again' });
      expect(second.status).toBe(409);

      const count = await prisma.reviewReport.count({ where: { reviewId: created.body.id } });
      expect(count).toBe(1); // the rejected second attempt never created a duplicate row.
    });
  });

  // -------------------------------------------------------------------
  // Wishlist
  // -------------------------------------------------------------------
  describe('Wishlist', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await api().get('/api/v1/wishlist');
      expect(res.status).toBe(401);
    });

    it('creates a wishlist lazily and adds/lists an item', async () => {
      const { token } = await createCustomer(`wishlist.basic.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`WishlistBasic ${runId}`, '250.00', 10);

      const empty = await api().get('/api/v1/wishlist').set('Authorization', auth(token));
      expect(empty.status).toBe(200);
      expect(empty.body.items).toHaveLength(0);

      const added = await api().post('/api/v1/wishlist/items').set('Authorization', auth(token)).send({ productId });
      expect(added.status).toBe(201);
      expect(added.body.productId).toBe(productId);
      expect(added.body.isAvailable).toBe(true);

      const list = await api().get('/api/v1/wishlist').set('Authorization', auth(token));
      expect(list.body.items).toHaveLength(1);
    });

    it('adding the same product twice is idempotent - no duplicate row, including under concurrency', async () => {
      const { token } = await createCustomer(`wishlist.duplicate.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`WishlistDuplicate ${runId}`, '250.00', 10);

      const first = await api().post('/api/v1/wishlist/items').set('Authorization', auth(token)).send({ productId });
      const second = await api().post('/api/v1/wishlist/items').set('Authorization', auth(token)).send({ productId });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);

      const { productId: productC } = await createProduct(`WishlistDuplicateRace ${runId}`, '250.00', 10);
      const [a, b] = await Promise.all([
        api().post('/api/v1/wishlist/items').set('Authorization', auth(token)).send({ productId: productC }),
        api().post('/api/v1/wishlist/items').set('Authorization', auth(token)).send({ productId: productC }),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      const wishlist = await prisma.wishlist.findFirstOrThrow({ where: { storeId, userId: (await prisma.user.findFirstOrThrow({ where: { email: `wishlist.duplicate.${runId}@example.com` } })).id } });
      const count = await prisma.wishlistItem.count({ where: { wishlistId: wishlist.id, productId: productC } });
      expect(count).toBe(1);
    });

    it('removes an item; rejects removing another customer\'s item (safe 404)', async () => {
      const { token: owner } = await createCustomer(`wishlist.removeowner.${runId}@example.com`, 'Secret123!');
      const { token: intruder } = await createCustomer(`wishlist.removeintruder.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`WishlistRemove ${runId}`, '250.00', 10);
      const added = await api().post('/api/v1/wishlist/items').set('Authorization', auth(owner)).send({ productId });

      const intruderAttempt = await api().delete(`/api/v1/wishlist/items/${added.body.id}`).set('Authorization', auth(intruder));
      expect(intruderAttempt.status).toBe(404);

      const ownerRemoves = await api().delete(`/api/v1/wishlist/items/${added.body.id}`).set('Authorization', auth(owner));
      expect(ownerRemoves.status).toBe(200);
    });

    it("Store B's customer cannot see or modify Store A's wishlist (tenant isolation)", async () => {
      const { token: ownerA } = await createCustomer(`wishlist.tenantA.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`WishlistTenant ${runId}`, '250.00', 10);
      const added = await api().post('/api/v1/wishlist/items').set('Authorization', auth(ownerA)).send({ productId });

      const storeB = await prisma.store.create({ data: { slug: `store-b-wishlist-${runId}`, name: 'Store B', isActive: true } });
      const roleB = await prisma.role.create({ data: { storeId: storeB.id, name: 'CUSTOMER' } });
      const userB = await prisma.user.create({
        data: { storeId: storeB.id, email: `storeb.wishlist.${runId}@example.com`, passwordHash: await argon2.hash('Secret123!'), type: 'CUSTOMER', isActive: true, emailVerifiedAt: new Date() },
      });
      await prisma.userRole.create({ data: { userId: userB.id, roleId: roleB.id } });
      const tokenB = await jwtService.signAsync(
        { sub: userB.id, storeId: storeB.id, email: userB.email, type: 'CUSTOMER', roles: ['CUSTOMER'], permissions: [] },
        { secret: configService.get('jwt', { infer: true }).accessSecret, expiresIn: '15m', algorithm: 'HS256', issuer: 'peshani-api', audience: 'peshani-client' },
      );

      const crossTenantList = await api().get('/api/v1/wishlist').set('Authorization', auth(tokenB));
      expect(crossTenantList.body.items).toHaveLength(0); // Store B's OWN (separate, empty) wishlist - never Store A's items.

      const crossTenantRemove = await api().delete(`/api/v1/wishlist/items/${added.body.id}`).set('Authorization', auth(tokenB));
      expect(crossTenantRemove.status).toBe(404);
    });

    it('rejects adding an inactive/archived product to the wishlist', async () => {
      const { token } = await createCustomer(`wishlist.inactive.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`WishlistInactive ${runId}`, '250.00', 10);
      await prisma.product.update({ where: { id: productId }, data: { status: 'ARCHIVED' } });

      const res = await api().post('/api/v1/wishlist/items').set('Authorization', auth(token)).send({ productId });
      expect(res.status).toBe(404);
    });

    it('tolerates a wishlist item whose product becomes inactive AFTER being added - isAvailable turns false, no crash', async () => {
      const { token } = await createCustomer(`wishlist.becomesinactive.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`WishlistBecomesInactive ${runId}`, '250.00', 10);
      await api().post('/api/v1/wishlist/items').set('Authorization', auth(token)).send({ productId });

      await prisma.product.update({ where: { id: productId }, data: { status: 'INACTIVE' } });

      const list = await api().get('/api/v1/wishlist').set('Authorization', auth(token));
      expect(list.status).toBe(200);
      const item = list.body.items.find((i: { productId: string }) => i.productId === productId);
      expect(item.isAvailable).toBe(false);
    });

    it('moves a wishlist item to the real cart via the existing CartService, then removes it', async () => {
      const { token } = await createCustomer(`wishlist.movetocart.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`WishlistMoveToCart ${runId}`, '250.00', 10);
      const added = await api().post('/api/v1/wishlist/items').set('Authorization', auth(token)).send({ productId });

      const moved = await api().post(`/api/v1/wishlist/items/${added.body.id}/move-to-cart`).set('Authorization', auth(token)).send({ quantity: 2 });
      expect(moved.status).toBe(201);
      expect(moved.body.items.some((i: { product: { id: string }; quantity: number }) => i.product.id === productId && i.quantity === 2)).toBe(true);

      const wishlistAfter = await api().get('/api/v1/wishlist').set('Authorization', auth(token));
      expect(wishlistAfter.body.items).toHaveLength(0); // removed after successful move.
    });

    it('Micro-correction Test 1: two simultaneous move-to-cart requests for the SAME wishlist item never double the cart quantity, and the wishlist item is not duplicated', async () => {
      const { token } = await createCustomer(`wishlist.moverace.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`WishlistMoveRace ${runId}`, '250.00', 100);
      const added = await api().post('/api/v1/wishlist/items').set('Authorization', auth(token)).send({ productId });

      const [a, b] = await Promise.all([
        api().post(`/api/v1/wishlist/items/${added.body.id}/move-to-cart`).set('Authorization', auth(token)).send({ quantity: 2 }),
        api().post(`/api/v1/wishlist/items/${added.body.id}/move-to-cart`).set('Authorization', auth(token)).send({ quantity: 2 }),
      ]);
      // Exactly one of the two racing requests represents the real move;
      // the other must be safely rejected (never silently also succeed).
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 404]);

      const winner = a.status === 201 ? a : b;
      const cartLine = winner.body.items.find((i: { product: { id: string } }) => i.product.id === productId);
      expect(cartLine).toBeDefined();
      expect(cartLine.quantity).toBe(2); // NOT 4 - the losing request never reached CartService.addItem at all.

      const cart = await prisma.cart.findFirstOrThrow({ where: { storeId, userId: (await prisma.user.findFirstOrThrow({ where: { email: `wishlist.moverace.${runId}@example.com` } })).id, status: 'ACTIVE' } });
      const cartItemRows = await prisma.cartItem.findMany({ where: { cartId: cart.id, productId } });
      expect(cartItemRows).toHaveLength(1); // no duplicate CartItem row either.
      expect(cartItemRows[0].quantity).toBe(2);

      const wishlistAfter = await api().get('/api/v1/wishlist').set('Authorization', auth(token));
      expect(wishlistAfter.body.items.some((i: { id: string }) => i.id === added.body.id)).toBe(false); // claimed exactly once.
    });

    it('Micro-correction Test 3: a sequential repeated move-to-cart request for the same (already-moved) item is safely rejected', async () => {
      const { token } = await createCustomer(`wishlist.moverepeat.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`WishlistMoveRepeat ${runId}`, '250.00', 10);
      const added = await api().post('/api/v1/wishlist/items').set('Authorization', auth(token)).send({ productId });

      const first = await api().post(`/api/v1/wishlist/items/${added.body.id}/move-to-cart`).set('Authorization', auth(token)).send({ quantity: 1 });
      expect(first.status).toBe(201);

      const second = await api().post(`/api/v1/wishlist/items/${added.body.id}/move-to-cart`).set('Authorization', auth(token)).send({ quantity: 1 });
      expect(second.status).toBe(404); // already moved - not found, never a second cart addition.

      const cart = await prisma.cart.findFirstOrThrow({ where: { storeId, userId: (await prisma.user.findFirstOrThrow({ where: { email: `wishlist.moverepeat.${runId}@example.com` } })).id, status: 'ACTIVE' } });
      const cartItemRows = await prisma.cartItem.findMany({ where: { cartId: cart.id, productId } });
      expect(cartItemRows).toHaveLength(1);
      expect(cartItemRows[0].quantity).toBe(1);
    });

    it('Micro-correction Test 4: two DIFFERENT wishlist items moved concurrently both succeed without interfering with each other', async () => {
      const { token } = await createCustomer(`wishlist.movetwodiff.${runId}@example.com`, 'Secret123!');
      const { productId: productA } = await createProduct(`WishlistMoveDiffA ${runId}`, '250.00', 10);
      const { productId: productB } = await createProduct(`WishlistMoveDiffB ${runId}`, '250.00', 10);
      const addedA = await api().post('/api/v1/wishlist/items').set('Authorization', auth(token)).send({ productId: productA });
      const addedB = await api().post('/api/v1/wishlist/items').set('Authorization', auth(token)).send({ productId: productB });

      const [a, b] = await Promise.all([
        api().post(`/api/v1/wishlist/items/${addedA.body.id}/move-to-cart`).set('Authorization', auth(token)).send({ quantity: 1 }),
        api().post(`/api/v1/wishlist/items/${addedB.body.id}/move-to-cart`).set('Authorization', auth(token)).send({ quantity: 1 }),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);

      const cart = await prisma.cart.findFirstOrThrow({ where: { storeId, userId: (await prisma.user.findFirstOrThrow({ where: { email: `wishlist.movetwodiff.${runId}@example.com` } })).id, status: 'ACTIVE' } });
      const cartItemRows = await prisma.cartItem.findMany({ where: { cartId: cart.id, productId: { in: [productA, productB] } } });
      expect(cartItemRows).toHaveLength(2);
      expect(cartItemRows.every((r) => r.quantity === 1)).toBe(true);

      const wishlistAfter = await api().get('/api/v1/wishlist').set('Authorization', auth(token));
      expect(wishlistAfter.body.items).toHaveLength(0);
    });

    it('a failed move-to-cart (insufficient stock) leaves the wishlist item in place', async () => {
      const { token } = await createCustomer(`wishlist.movefail.${runId}@example.com`, 'Secret123!');
      const { productId } = await createProduct(`WishlistMoveFail ${runId}`, '250.00', 1);
      const added = await api().post('/api/v1/wishlist/items').set('Authorization', auth(token)).send({ productId });

      const moved = await api().post(`/api/v1/wishlist/items/${added.body.id}/move-to-cart`).set('Authorization', auth(token)).send({ quantity: 999 });
      expect(moved.status).toBeGreaterThanOrEqual(400);

      const wishlistAfter = await api().get('/api/v1/wishlist').set('Authorization', auth(token));
      expect(wishlistAfter.body.items.some((i: { id: string }) => i.id === added.body.id)).toBe(true); // NOT removed - the move never succeeded.
    });
  });

  // -------------------------------------------------------------------
  // Database invariants
  // -------------------------------------------------------------------
  describe('Database invariants', () => {
    it('no review has an invalid rating', async () => {
      const invalid = await prisma.productReview.count({ where: { storeId, OR: [{ rating: { lt: 1 } }, { rating: { gt: 5 } }] } });
      expect(invalid).toBe(0);
    });

    it('no duplicate review per orderItemId', async () => {
      const grouped = await prisma.productReview.groupBy({ by: ['orderItemId'], _count: { _all: true }, having: { orderItemId: { _count: { gt: 1 } } } });
      expect(grouped).toHaveLength(0);
    });

    it('no duplicate helpful vote per reviewId+userId', async () => {
      const grouped = await prisma.reviewHelpfulVote.groupBy({ by: ['reviewId', 'userId'], _count: { _all: true }, having: { reviewId: { _count: { gt: 1 } } } });
      expect(grouped).toHaveLength(0);
    });

    it('no duplicate wishlist item per wishlistId+itemKey', async () => {
      const grouped = await prisma.wishlistItem.groupBy({ by: ['wishlistId', 'itemKey'], _count: { _all: true }, having: { wishlistId: { _count: { gt: 1 } } } });
      expect(grouped).toHaveLength(0);
    });

    it('no cross-store review relationships (review.storeId matches its product/order/user store)', async () => {
      const reviews = await prisma.productReview.findMany({ include: { product: true, order: true, user: true } });
      let bad = 0;
      for (const r of reviews) {
        if (r.product && r.product.storeId !== r.storeId) bad++;
        if (r.order.storeId !== r.storeId) bad++;
        if (r.user.storeId !== r.storeId) bad++;
      }
      expect(bad).toBe(0);
    });

    it('no cross-store wishlist relationships', async () => {
      const wishlists = await prisma.wishlist.findMany({ include: { user: true, items: { include: { product: true } } } });
      let bad = 0;
      for (const w of wishlists) {
        if (w.user.storeId !== w.storeId) bad++;
        for (const item of w.items) {
          if (item.product.storeId !== w.storeId) bad++;
        }
      }
      expect(bad).toBe(0);
    });

    it('no orphaned wishlist items (every item has a valid wishlist and product)', async () => {
      const items = await prisma.wishlistItem.findMany({ include: { wishlist: true, product: true } });
      expect(items.every((i) => i.wishlist !== null && i.product !== null)).toBe(true);
    });

    it('no orphaned review references (every review has a valid order and orderItem)', async () => {
      const reviews = await prisma.productReview.findMany({ include: { order: true, orderItem: true } });
      expect(reviews.every((r) => r.order !== null && r.orderItem !== null)).toBe(true);
    });

    it('approved review counts match the rating summary for a sampled product', async () => {
      const sampleReview = await prisma.productReview.findFirst({ where: { storeId, status: 'APPROVED' } });
      if (!sampleReview || !sampleReview.productId) return;
      const directCount = await prisma.productReview.count({ where: { storeId, productId: sampleReview.productId, status: 'APPROVED', deletedAt: null } });
      const summary = await api().get(`/api/v1/products/${sampleReview.productId}/reviews/summary`);
      expect(summary.body.totalReviews).toBe(directCount);
    });

    it('no invalid verified-purchase relationship - every verifiedPurchase=true review has an OrderItem belonging to the same user and store', async () => {
      const reviews = await prisma.productReview.findMany({ where: { verifiedPurchase: true }, include: { order: true, orderItem: true } });
      let bad = 0;
      for (const r of reviews) {
        if (r.order.userId !== r.userId) bad++;
        if (r.orderItem.orderId !== r.orderId) bad++;
      }
      expect(bad).toBe(0);
    });
  });
});
