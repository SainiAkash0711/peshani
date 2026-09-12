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

const GUEST_HEADER = 'X-Guest-Cart-Token';

describe('Peshani Cart (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService<AppConfig, true>;
  let storeId: string;

  const runId = Date.now();
  const api = () => request(app.getHttpServer());
  const withGuest = (req: request.Test, token?: string) => (token ? req.set(GUEST_HEADER, token) : req);
  const auth = (token: string) => `Bearer ${token}`;

  let warehouseId: string;

  let simpleProductId: string; // ACTIVE, 10 available, threshold 2
  let lowStockProductId: string; // ACTIVE, 1 available (threshold irrelevant), used for insufficient-stock tests
  let outOfStockProductId: string; // ACTIVE, 0 available
  let draftProductId: string;
  let deletedProductId: string;

  let variableProductId: string;
  let activeVariantId: string; // 3 available
  let inactiveVariantId: string;

  let userAEmail: string;
  let userAId: string;
  let userAToken: string;
  let userBEmail: string;
  let userBToken: string;

  let storeBToken: string;
  let storeBProductId: string;

  async function createCustomer(email: string, password: string) {
    const passwordHash = await argon2.hash(password);
    const role = await prisma.role.findUnique({ where: { storeId_name: { storeId, name: 'CUSTOMER' } } });
    const user = await prisma.user.create({
      data: { storeId, email, passwordHash, type: 'CUSTOMER', isActive: true, emailVerifiedAt: new Date() },
    });
    if (role) await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    return user;
  }

  async function loginCustomer(email: string, password: string, guestToken?: string) {
    const req = api().post('/api/v1/auth/login').send({ email, password });
    if (guestToken) req.set(GUEST_HEADER, guestToken);
    return req;
  }

  async function createSimpleProduct(name: string, basePrice: string, available: number, threshold = 0) {
    const product = await prisma.product.create({
      data: { storeId, name, slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${runId}`, sku: `${name.replace(/\s+/g, '')}-${runId}`, status: 'ACTIVE', productType: 'SIMPLE', basePrice },
    });
    await prisma.inventoryItem.create({
      data: { storeId, productId: product.id, variantId: null, warehouseId, onHandQuantity: available, availableQuantity: available, reservedQuantity: 0, lowStockThreshold: threshold },
    });
    return product.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService<AppConfig, true>);

    const store = await prisma.store.findUniqueOrThrow({ where: { slug: DEFAULT_STORE_SLUG } });
    storeId = store.id;

    const warehouse = await prisma.warehouse.create({ data: { storeId, name: `Cart WH ${runId}`, code: `CART-WH-${runId}`, isActive: true } });
    warehouseId = warehouse.id;

    simpleProductId = await createSimpleProduct(`Cart Simple ${runId}`, '250.00', 10, 2);
    lowStockProductId = await createSimpleProduct(`Cart LowStock ${runId}`, '100.00', 1);
    outOfStockProductId = await createSimpleProduct(`Cart OOS ${runId}`, '75.00', 0);

    const draft = await prisma.product.create({
      data: { storeId, name: `Cart Draft ${runId}`, slug: `cart-draft-${runId}`, sku: `CARTDRAFT-${runId}`, status: 'DRAFT', productType: 'SIMPLE', basePrice: '10.00' },
    });
    draftProductId = draft.id;

    const deleted = await prisma.product.create({
      data: { storeId, name: `Cart Deleted ${runId}`, slug: `cart-deleted-${runId}`, sku: `CARTDELETED-${runId}`, status: 'ACTIVE', productType: 'SIMPLE', basePrice: '10.00', deletedAt: new Date() },
    });
    deletedProductId = deleted.id;

    const colorAttr = await prisma.attribute.create({ data: { storeId, name: `CartColor ${runId}`, slug: `cart-color-${runId}` } });
    const black = await prisma.attributeValue.create({ data: { attributeId: colorAttr.id, value: 'Black', slug: 'black' } });
    const white = await prisma.attributeValue.create({ data: { attributeId: colorAttr.id, value: 'White', slug: 'white' } });
    const variable = await prisma.product.create({
      data: { storeId, name: `Cart Variable ${runId}`, slug: `cart-variable-${runId}`, status: 'ACTIVE', productType: 'VARIABLE', basePrice: '500.00' },
    });
    variableProductId = variable.id;
    const activeVariant = await prisma.productVariant.create({
      data: { storeId, productId: variable.id, sku: `CARTVAR-A-${runId}`, price: '500.00', status: 'ACTIVE', combinationKey: black.id },
    });
    activeVariantId = activeVariant.id;
    await prisma.productVariantAttributeValue.create({ data: { variantId: activeVariant.id, attributeValueId: black.id } });
    await prisma.inventoryItem.create({
      data: { storeId, productId: variable.id, variantId: activeVariant.id, warehouseId, onHandQuantity: 3, availableQuantity: 3, reservedQuantity: 0 },
    });
    const inactiveVariant = await prisma.productVariant.create({
      data: { storeId, productId: variable.id, sku: `CARTVAR-I-${runId}`, price: '500.00', status: 'INACTIVE', combinationKey: white.id },
    });
    inactiveVariantId = inactiveVariant.id;
    await prisma.productVariantAttributeValue.create({ data: { variantId: inactiveVariant.id, attributeValueId: white.id } });

    userAEmail = `cart.usera.${runId}@example.com`;
    const userA = await createCustomer(userAEmail, 'Secret123!');
    userAId = userA.id;
    const loginA = await loginCustomer(userAEmail, 'Secret123!');
    userAToken = loginA.body.accessToken;

    userBEmail = `cart.userb.${runId}@example.com`;
    await createCustomer(userBEmail, 'Secret123!');
    const loginB = await loginCustomer(userBEmail, 'Secret123!');
    userBToken = loginB.body.accessToken;

    // Store B: second tenant, JWT minted directly (documented workaround -
    // /auth/login is single-store-only, see the existing e2e test convention).
    const storeB = await prisma.store.create({ data: { slug: `cart-store-b-${runId}`, name: 'Cart Store B', isActive: true } });
    const userB = await prisma.user.create({
      data: { storeId: storeB.id, email: `cart.storeb.${runId}@example.com`, passwordHash: 'irrelevant', type: 'CUSTOMER', isActive: true },
    });
    const whB = await prisma.warehouse.create({ data: { storeId: storeB.id, name: 'Cart WH B', code: `CART-WH-B-${runId}`, isActive: true } });
    const productB = await prisma.product.create({
      data: { storeId: storeB.id, name: 'Cart Store B Product', slug: `cart-storeb-product-${runId}`, sku: `CARTSTOREB-${runId}`, status: 'ACTIVE', productType: 'SIMPLE', basePrice: '99.00' },
    });
    storeBProductId = productB.id;
    await prisma.inventoryItem.create({
      data: { storeId: storeB.id, productId: productB.id, variantId: null, warehouseId: whB.id, onHandQuantity: 5, availableQuantity: 5, reservedQuantity: 0 },
    });
    storeBToken = await jwtService.signAsync(
      { sub: userB.id, storeId: storeB.id, email: userB.email, type: 'CUSTOMER', roles: [], permissions: [] },
      { secret: configService.get('jwt', { infer: true }).accessSecret, expiresIn: '15m', algorithm: 'HS256', issuer: 'peshani-api', audience: 'peshani-client' },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Guest cart identity', () => {
    it('creates a fresh guest cart and returns a guest token header when none is supplied', async () => {
      const res = await api().get('/api/v1/cart');
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.headers[GUEST_HEADER.toLowerCase()]).toBeDefined();
    });

    it('returns the SAME cart on a subsequent request carrying the same guest token', async () => {
      const first = await api().get('/api/v1/cart');
      const token = first.headers[GUEST_HEADER.toLowerCase()];
      const second = await withGuest(api().get('/api/v1/cart'), token);
      expect(second.body.id).toBe(first.body.id);
    });

    it('two different guest tokens never see the same cart', async () => {
      const a = await api().get('/api/v1/cart');
      const b = await api().get('/api/v1/cart');
      expect(a.body.id).not.toBe(b.body.id);
    });

    it('an unknown/garbage guest token transparently gets a brand new cart, not an error', async () => {
      const res = await withGuest(api().get('/api/v1/cart'), 'not-a-real-token');
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });
  });

  describe('Add to cart - SIMPLE product', () => {
    it('adds a SIMPLE product with the server-authoritative price', async () => {
      const res = await api().post('/api/v1/cart/items').send({ productId: simpleProductId, quantity: 2 });
      expect(res.status).toBe(201);
      expect(res.body.items[0].unitPrice).toBe('250.00');
      expect(res.body.items[0].lineTotal).toBe('500.00');
      expect(res.body.itemCount).toBe(2);
    });

    it('increments quantity on a repeat add of the same product rather than duplicating the line', async () => {
      const first = await api().post('/api/v1/cart/items').send({ productId: simpleProductId, quantity: 2 });
      const token = first.headers[GUEST_HEADER.toLowerCase()];
      const second = await withGuest(api().post('/api/v1/cart/items'), token).send({ productId: simpleProductId, quantity: 3 });
      expect(second.body.items).toHaveLength(1);
      expect(second.body.items[0].quantity).toBe(5);
    });

    it('rejects a client-supplied unitPrice/currency/userId/storeId (unknown fields whitelisted away)', async () => {
      const res = await api()
        .post('/api/v1/cart/items')
        .send({ productId: simpleProductId, quantity: 1, unitPrice: '1.00', currency: 'USD', userId: 'x', storeId: 'y' });
      expect(res.status).toBe(400);
    });

    it.each([0, -1, 1.5, 999999])('rejects an invalid quantity: %p', async (quantity) => {
      const res = await api().post('/api/v1/cart/items').send({ productId: simpleProductId, quantity });
      expect(res.status).toBe(400);
    });

    it('rejects a non-numeric quantity string', async () => {
      const res = await api().post('/api/v1/cart/items').send({ productId: simpleProductId, quantity: 'abc' });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown productId', async () => {
      const res = await api().post('/api/v1/cart/items').send({ productId: '00000000-0000-0000-0000-000000000000', quantity: 1 });
      expect(res.status).toBe(404);
    });

    it('rejects a DRAFT product', async () => {
      const res = await api().post('/api/v1/cart/items').send({ productId: draftProductId, quantity: 1 });
      expect(res.status).toBe(404);
    });

    it('rejects a soft-deleted product', async () => {
      const res = await api().post('/api/v1/cart/items').send({ productId: deletedProductId, quantity: 1 });
      expect(res.status).toBe(404);
    });

    it('rejects adding more than is currently available', async () => {
      const res = await api().post('/api/v1/cart/items').send({ productId: lowStockProductId, quantity: 5 });
      expect(res.status).toBe(409);
    });

    it('rejects adding an out-of-stock product entirely', async () => {
      const res = await api().post('/api/v1/cart/items').send({ productId: outOfStockProductId, quantity: 1 });
      expect(res.status).toBe(409);
    });
  });

  describe('Add to cart - VARIABLE product', () => {
    it('rejects a VARIABLE product with no variantId', async () => {
      const res = await api().post('/api/v1/cart/items').send({ productId: variableProductId, quantity: 1 });
      expect(res.status).toBe(400);
    });

    it('rejects a SIMPLE product WITH a variantId', async () => {
      const res = await api().post('/api/v1/cart/items').send({ productId: simpleProductId, variantId: activeVariantId, quantity: 1 });
      expect(res.status).toBe(400);
    });

    it('rejects an INACTIVE variant', async () => {
      const res = await api().post('/api/v1/cart/items').send({ productId: variableProductId, variantId: inactiveVariantId, quantity: 1 });
      expect(res.status).toBe(404);
    });

    it('adds a valid ACTIVE variant with the variant\'s own price', async () => {
      const res = await api().post('/api/v1/cart/items').send({ productId: variableProductId, variantId: activeVariantId, quantity: 1 });
      expect(res.status).toBe(201);
      expect(res.body.items[0].unitPrice).toBe('500.00');
      expect(res.body.items[0].variant.id).toBe(activeVariantId);
    });
  });

  describe('Update / remove / clear', () => {
    async function seedCartWithOneItem() {
      const res = await api().post('/api/v1/cart/items').send({ productId: simpleProductId, quantity: 2 });
      const token = res.headers[GUEST_HEADER.toLowerCase()];
      return { token, itemId: res.body.items[0].id };
    }

    it('updates quantity within stock', async () => {
      const { token, itemId } = await seedCartWithOneItem();
      const res = await withGuest(api().patch(`/api/v1/cart/items/${itemId}`), token).send({ quantity: 5 });
      expect(res.status).toBe(200);
      expect(res.body.items[0].quantity).toBe(5);
    });

    it('rejects a quantity update that exceeds available stock', async () => {
      const { token, itemId } = await seedCartWithOneItem();
      // simpleProductId only ever has 10 available - 15 is within the DTO's own
      // 1-100 bound (so this exercises the STOCK check, not quantity validation).
      const res = await withGuest(api().patch(`/api/v1/cart/items/${itemId}`), token).send({ quantity: 15 });
      expect(res.status).toBe(409);
    });

    it('rejects a quantity update of 0 (use remove instead)', async () => {
      const { token, itemId } = await seedCartWithOneItem();
      const res = await withGuest(api().patch(`/api/v1/cart/items/${itemId}`), token).send({ quantity: 0 });
      expect(res.status).toBe(400);
    });

    it('removes an item, and repeating the removal is idempotent (not an error)', async () => {
      const { token, itemId } = await seedCartWithOneItem();
      const first = await withGuest(api().delete(`/api/v1/cart/items/${itemId}`), token);
      expect(first.status).toBe(200);
      expect(first.body.items).toEqual([]);
      const second = await withGuest(api().delete(`/api/v1/cart/items/${itemId}`), token);
      expect(second.status).toBe(200);
    });

    it('clears the whole cart, and repeating the clear is idempotent', async () => {
      const first = await api().post('/api/v1/cart/items').send({ productId: simpleProductId, quantity: 1 });
      const token = first.headers[GUEST_HEADER.toLowerCase()];
      const cleared = await withGuest(api().delete('/api/v1/cart'), token);
      expect(cleared.body.items).toEqual([]);
      const clearedAgain = await withGuest(api().delete('/api/v1/cart'), token);
      expect(clearedAgain.status).toBe(200);
    });
  });

  describe('Price-change and stale-item detection', () => {
    it('reflects a live price change on the next read and marks the line PRICE_CHANGED', async () => {
      const priceChangeProductId = await createSimpleProduct(`Cart PriceChange ${runId}`, '300.00', 50, 1);
      const added = await api().post('/api/v1/cart/items').send({ productId: priceChangeProductId, quantity: 1 });
      const token = added.headers[GUEST_HEADER.toLowerCase()];
      expect(added.body.items[0].unitPrice).toBe('300.00');

      await prisma.product.update({ where: { id: priceChangeProductId }, data: { basePrice: '349.00' } });

      const res = await withGuest(api().get('/api/v1/cart'), token);
      expect(res.body.items[0].unitPrice).toBe('349.00');
      expect(res.body.items[0].status).toBe('PRICE_CHANGED');
      expect(res.body.items[0].priceChanged).toBe(true);
    });

    it('marks a line PRODUCT_UNAVAILABLE once the product is deactivated after being added', async () => {
      const goneProductId = await createSimpleProduct(`Cart Goes Inactive ${runId}`, '100.00', 10, 1);
      const added = await api().post('/api/v1/cart/items').send({ productId: goneProductId, quantity: 1 });
      const token = added.headers[GUEST_HEADER.toLowerCase()];

      await prisma.product.update({ where: { id: goneProductId }, data: { status: 'INACTIVE' } });

      const res = await withGuest(api().get('/api/v1/cart'), token);
      expect(res.body.items[0].status).toBe('PRODUCT_UNAVAILABLE');
    });
  });

  describe('Ownership & tenant isolation', () => {
    it("customer A's authenticated cart is never visible to customer B", async () => {
      await api().post('/api/v1/cart/items').set('Authorization', auth(userAToken)).send({ productId: simpleProductId, quantity: 1 });
      const cartB = await api().get('/api/v1/cart').set('Authorization', auth(userBToken));
      expect(cartB.body.items.find((i: { product: { id: string } }) => i.product.id === simpleProductId)).toBeUndefined();
    });

    it("Store B's authenticated cart is scoped to Store B, never Store A's default store", async () => {
      const res = await api().post('/api/v1/cart/items').set('Authorization', auth(storeBToken)).send({ productId: storeBProductId, quantity: 1 });
      expect(res.status).toBe(201);
      const cart = await prisma.cart.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(cart.storeId).not.toBe(storeId);
    });

    it("Store B's JWT cannot add Store A's product to its cart (cross-tenant product reference rejected)", async () => {
      const res = await api().post('/api/v1/cart/items').set('Authorization', auth(storeBToken)).send({ productId: simpleProductId, quantity: 1 });
      expect(res.status).toBe(404);
    });

    it("removing another user's item id is a safe no-op, never a cross-tenant mutation", async () => {
      const addedByA = await api().post('/api/v1/cart/items').set('Authorization', auth(userAToken)).send({ productId: lowStockProductId, quantity: 1 });
      const aItemId = addedByA.body.items.find((i: { product: { id: string } }) => i.product.id === lowStockProductId).id;

      const deleteAttempt = await api().delete(`/api/v1/cart/items/${aItemId}`).set('Authorization', auth(userBToken));
      expect(deleteAttempt.status).toBe(200); // idempotent no-op from B's own perspective, no error leaking existence

      const stillThere = await api().get('/api/v1/cart').set('Authorization', auth(userAToken));
      expect(stillThere.body.items.find((i: { id: string }) => i.id === aItemId)).toBeDefined();
    });

    it("updating another user's item id returns 404, not the item", async () => {
      const addedByA = await api().post('/api/v1/cart/items').set('Authorization', auth(userAToken)).send({ productId: simpleProductId, quantity: 1 });
      const aItemId = addedByA.body.items.find((i: { product: { id: string } }) => i.product.id === simpleProductId).id;

      const res = await api().patch(`/api/v1/cart/items/${aItemId}`).set('Authorization', auth(userBToken)).send({ quantity: 2 });
      expect(res.status).toBe(404);
    });

    it('rejects an unauthenticated request to a route requiring an item id belonging to no one (still just 404, no crash)', async () => {
      const res = await api().patch(`/api/v1/cart/items/00000000-0000-0000-0000-000000000000`).send({ quantity: 2 });
      expect(res.status).toBe(404);
    });
  });

  describe('Guest -> customer cart merge', () => {
    it('merges a guest cart into the customer cart on login and reports the summary', async () => {
      const email = `cart.mergeflow1.${runId}@example.com`;
      await createCustomer(email, 'Secret123!');

      const added = await api().post('/api/v1/cart/items').send({ productId: simpleProductId, quantity: 2 });
      const guestToken = added.headers[GUEST_HEADER.toLowerCase()];

      const login = await loginCustomer(email, 'Secret123!', guestToken);
      expect(login.status).toBe(200);
      expect(login.body.cartMerge.merged).toContain(simpleProductId);

      const cart = await api().get('/api/v1/cart').set('Authorization', auth(login.body.accessToken));
      expect(cart.body.items.find((i: { product: { id: string } }) => i.product.id === simpleProductId)?.quantity).toBe(2);
    });

    it('sums quantities when the same product exists in both the guest cart and an existing customer cart', async () => {
      const email = `cart.mergeflow2.${runId}@example.com`;
      await createCustomer(email, 'Secret123!');
      const firstLogin = await loginCustomer(email, 'Secret123!');
      await api().post('/api/v1/cart/items').set('Authorization', auth(firstLogin.body.accessToken)).send({ productId: lowStockProductId, quantity: 1 });

      // Guest adds a DIFFERENT, well-stocked product carrying the same identity as no existing line.
      const added = await api().post('/api/v1/cart/items').send({ productId: simpleProductId, quantity: 2 });
      const guestToken = added.headers[GUEST_HEADER.toLowerCase()];

      const secondLogin = await loginCustomer(email, 'Secret123!', guestToken);
      const cart = await api().get('/api/v1/cart').set('Authorization', auth(secondLogin.body.accessToken));
      const simpleLine = cart.body.items.find((i: { product: { id: string } }) => i.product.id === simpleProductId);
      const lowStockLine = cart.body.items.find((i: { product: { id: string } }) => i.product.id === lowStockProductId);
      expect(simpleLine.quantity).toBe(2);
      expect(lowStockLine.quantity).toBe(1);
    });

    it('caps the merged quantity at available stock rather than overselling', async () => {
      const email = `cart.mergeflow3.${runId}@example.com`;
      await createCustomer(email, 'Secret123!');

      // lowStockProductId only ever has 1 unit available - a guest requesting 1 unit merges
      // cleanly, but the merge must never push the RESULT above what's actually available.
      const added = await api().post('/api/v1/cart/items').send({ productId: lowStockProductId, quantity: 1 });
      const guestToken = added.headers[GUEST_HEADER.toLowerCase()];

      const login = await loginCustomer(email, 'Secret123!', guestToken);
      const cart = await api().get('/api/v1/cart').set('Authorization', auth(login.body.accessToken));
      const line = cart.body.items.find((i: { product: { id: string } }) => i.product.id === lowStockProductId);
      expect(line.quantity).toBeLessThanOrEqual(1);
    });

    it('removes a line whose product became unavailable before the merge happened', async () => {
      const goneProductId = await createSimpleProduct(`Cart Merge Gone ${runId}`, '20.00', 5, 1);
      const email = `cart.mergeflow4.${runId}@example.com`;
      await createCustomer(email, 'Secret123!');

      const added = await api().post('/api/v1/cart/items').send({ productId: goneProductId, quantity: 1 });
      const guestToken = added.headers[GUEST_HEADER.toLowerCase()];

      await prisma.product.update({ where: { id: goneProductId }, data: { status: 'ARCHIVED' } });

      const login = await loginCustomer(email, 'Secret123!', guestToken);
      expect(login.body.cartMerge.removed.some((r: { productId: string }) => r.productId === goneProductId)).toBe(true);

      const cart = await api().get('/api/v1/cart').set('Authorization', auth(login.body.accessToken));
      expect(cart.body.items.find((i: { product: { id: string } }) => i.product.id === goneProductId)).toBeUndefined();
    });

    it('a repeated login with the same (now-consumed) guest token does not merge or duplicate anything again', async () => {
      const email = `cart.mergeflow5.${runId}@example.com`;
      await createCustomer(email, 'Secret123!');

      const added = await api().post('/api/v1/cart/items').send({ productId: simpleProductId, quantity: 1 });
      const guestToken = added.headers[GUEST_HEADER.toLowerCase()];

      const firstLogin = await loginCustomer(email, 'Secret123!', guestToken);
      expect(firstLogin.body.cartMerge.merged).toContain(simpleProductId);

      const secondLogin = await loginCustomer(email, 'Secret123!', guestToken);
      expect(secondLogin.body.cartMerge).toBeUndefined();

      const cart = await api().get('/api/v1/cart').set('Authorization', auth(secondLogin.body.accessToken));
      expect(cart.body.items.filter((i: { product: { id: string } }) => i.product.id === simpleProductId)).toHaveLength(1);
    });

    it('a login with no guest token at all never touches cart state', async () => {
      const email = `cart.mergeflow6.${runId}@example.com`;
      await createCustomer(email, 'Secret123!');
      const login = await loginCustomer(email, 'Secret123!');
      expect(login.body.cartMerge).toBeUndefined();
    });
  });

  describe('Concurrency (real PostgreSQL races)', () => {
    it('two simultaneous adds of the same product sum to quantity=2, never overwrite to 1', async () => {
      const concurrentProductId = await createSimpleProduct(`Cart Concurrent ${runId}`, '150.00', 50, 1);
      const first = await api().get('/api/v1/cart');
      const token = first.headers[GUEST_HEADER.toLowerCase()];

      const [r1, r2] = await Promise.all([
        withGuest(api().post('/api/v1/cart/items'), token).send({ productId: concurrentProductId, quantity: 1 }),
        withGuest(api().post('/api/v1/cart/items'), token).send({ productId: concurrentProductId, quantity: 1 }),
      ]);
      expect([r1.status, r2.status]).toEqual([201, 201]);

      const final = await withGuest(api().get('/api/v1/cart'), token);
      const line = final.body.items.find((i: { product: { id: string } }) => i.product.id === concurrentProductId);
      expect(line.quantity).toBe(2);
    });

    it('a concurrent add that would push quantity past available stock is rejected without corrupting the surviving line', async () => {
      const tightProductId = await createSimpleProduct(`Cart Tight Stock ${runId}`, '80.00', 3, 1);
      const first = await api().get('/api/v1/cart');
      const token = first.headers[GUEST_HEADER.toLowerCase()];

      const results = await Promise.all([
        withGuest(api().post('/api/v1/cart/items'), token).send({ productId: tightProductId, quantity: 2 }),
        withGuest(api().post('/api/v1/cart/items'), token).send({ productId: tightProductId, quantity: 2 }),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);

      const final = await withGuest(api().get('/api/v1/cart'), token);
      const line = final.body.items.find((i: { product: { id: string } }) => i.product.id === tightProductId);
      expect(line.quantity).toBe(2); // the rejected +2 never landed - not 4, not 0
    });
  });

  describe('PostgreSQL invariant verification', () => {
    it('no CartItem has quantity <= 0', async () => {
      const bad = await prisma.cartItem.count({ where: { quantity: { lte: 0 } } });
      expect(bad).toBe(0);
    });

    it('no two CartItem rows share (cartId, itemKey) - the deduplication constraint truly holds', async () => {
      const duplicates = await prisma.cartItem.groupBy({
        by: ['cartId', 'itemKey'],
        _count: { id: true },
        having: { id: { _count: { gt: 1 } } },
      });
      expect(duplicates).toEqual([]);
    });

    it('every Cart with a userId has no more than one row with status ACTIVE for that user', async () => {
      const activeCarts = await prisma.cart.groupBy({
        by: ['storeId', 'userId'],
        where: { userId: { not: null }, status: 'ACTIVE' },
        _count: { id: true },
        having: { id: { _count: { gt: 1 } } },
      });
      expect(activeCarts).toEqual([]);
    });

    it("every CartItem's lineTotal (via the API) equals unitPrice * quantity", async () => {
      const res = await api().post('/api/v1/cart/items').send({ productId: simpleProductId, quantity: 3 });
      const line = res.body.items[0];
      expect(line.lineTotal).toBe((Number(line.unitPrice) * line.quantity).toFixed(2));
    });
  });
});
