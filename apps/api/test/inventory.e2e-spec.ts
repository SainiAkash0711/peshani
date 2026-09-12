import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppConfig } from '../src/config/configuration';

describe('Peshani Inventory (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let customerToken: string;
  let storeBToken: string;
  let storeId: string;

  const runId = Date.now();
  const auth = (token: string) => `Bearer ${token}`;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peshani.example';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const customerEmail = `inventory.customer.${runId}@example.com`;
  const customerPassword = 'SuperSecret123!';

  let warehouseAId: string;
  let warehouseBId: string;
  let simpleProductId: string;
  let variableProductId: string;
  let variantId: string;

  let storeBProductId: string;
  let storeBWarehouseId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;

    const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', auth(adminToken));
    storeId = me.body.storeId;

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: customerEmail, password: customerPassword });
    const customerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: customerEmail, password: customerPassword });
    customerToken = customerLogin.body.accessToken;

    const warehouseA = await prisma.warehouse.create({ data: { storeId, name: 'Inv Warehouse A', code: `INVA-${runId}` } });
    warehouseAId = warehouseA.id;
    const warehouseB = await prisma.warehouse.create({ data: { storeId, name: 'Inv Warehouse B', code: `INVB-${runId}` } });
    warehouseBId = warehouseB.id;

    const simpleProduct = await prisma.product.create({
      data: { storeId, name: `Inv Simple Product ${runId}`, slug: `inv-simple-product-${runId}`, basePrice: '100.00', sku: `INV-SIMPLE-${runId}` },
    });
    simpleProductId = simpleProduct.id;

    const variableProduct = await prisma.product.create({
      data: { storeId, name: `Inv Variable Product ${runId}`, slug: `inv-variable-product-${runId}`, basePrice: '200.00', productType: 'VARIABLE' },
    });
    variableProductId = variableProduct.id;
    const variant = await prisma.productVariant.create({
      data: { storeId, productId: variableProductId, sku: `INV-VARIANT-${runId}`, price: '200.00', combinationKey: `invkey-${runId}` },
    });
    variantId = variant.id;

    // Store B: second tenant for cross-tenant tests.
    const storeB = await prisma.store.create({ data: { slug: `store-b-inventory-${runId}`, name: 'Store B', isActive: true } });
    const perms = await prisma.permission.findMany({
      where: { key: { in: ['inventory.read', 'inventory.adjust', 'inventory.transfer', 'inventory.reserve', 'inventory.release'] } },
    });
    const roleB = await prisma.role.create({ data: { storeId: storeB.id, name: 'ADMIN' } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: roleB.id, permissionId: p.id })) });
    const userB = await prisma.user.create({
      data: {
        storeId: storeB.id,
        email: `storeb.inventory.${runId}@example.com`,
        passwordHash: await argon2.hash('irrelevant'),
        type: 'ADMIN',
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.userRole.create({ data: { userId: userB.id, roleId: roleB.id } });
    storeBProductId = (
      await prisma.product.create({ data: { storeId: storeB.id, name: 'Store B Inv Product', slug: `store-b-inv-product-${runId}`, basePrice: '5.00', sku: `STOREB-INV-${runId}` } })
    ).id;
    storeBWarehouseId = (await prisma.warehouse.create({ data: { storeId: storeB.id, name: 'Store B Warehouse', code: `STOREB-WH-${runId}` } })).id;

    const jwtService = app.get(JwtService);
    const configService = app.get(ConfigService<AppConfig, true>);
    storeBToken = await jwtService.signAsync(
      {
        sub: userB.id,
        storeId: storeB.id,
        email: userB.email,
        type: 'ADMIN',
        roles: ['ADMIN'],
        permissions: perms.map((p) => p.key),
      },
      { secret: configService.get('jwt', { infer: true }).accessSecret, expiresIn: '15m', algorithm: 'HS256', issuer: 'peshani-api', audience: 'peshani-client' },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Initialization', () => {
    let simpleInventoryId: string;
    let variantInventoryId: string;

    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/inventory');
      expect(res.status).toBe(401);
    });

    it('rejects a plain customer', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/inventory').set('Authorization', auth(customerToken));
      expect(res.status).toBe(403);
    });

    it('initializes inventory for a SIMPLE product', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory')
        .set('Authorization', auth(adminToken))
        .send({ warehouseId: warehouseAId, productId: simpleProductId, quantity: 20, lowStockThreshold: 5 });
      expect(res.status).toBe(201);
      expect(res.body.onHandQuantity).toBe(20);
      expect(res.body.availableQuantity).toBe(20);
      expect(res.body.reservedQuantity).toBe(0);
      simpleInventoryId = res.body.id;
    });

    it('rejects re-initializing the same product+warehouse', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory')
        .set('Authorization', auth(adminToken))
        .send({ warehouseId: warehouseAId, productId: simpleProductId, quantity: 5 });
      expect(res.status).toBe(409);
    });

    it('initializes inventory for a VARIABLE product variant', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory')
        .set('Authorization', auth(adminToken))
        .send({ warehouseId: warehouseAId, productId: variableProductId, variantId, quantity: 15 });
      expect(res.status).toBe(201);
      variantInventoryId = res.body.id;
    });

    it('rejects an invalid warehouse id', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory')
        .set('Authorization', auth(adminToken))
        .send({ warehouseId: '00000000-0000-0000-0000-000000000000', productId: simpleProductId, quantity: 1 });
      expect(res.status).toBe(404);
    });

    it('rejects a variant that does not belong to the given product', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory')
        .set('Authorization', auth(adminToken))
        .send({ warehouseId: warehouseBId, productId: simpleProductId, variantId, quantity: 1 });
      expect(res.status).toBe(404);
    });

    it('gets an inventory item by id, with product/variant/warehouse expanded', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/inventory/${simpleInventoryId}`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.warehouse.id).toBe(warehouseAId);
      expect(res.body.product.id).toBe(simpleProductId);
    });

    it('lists inventory filtered by warehouse and searches by SKU', async () => {
      const byWarehouse = await request(app.getHttpServer())
        .get(`/api/v1/inventory?warehouseId=${warehouseAId}`)
        .set('Authorization', auth(adminToken));
      expect(byWarehouse.body.items.length).toBeGreaterThanOrEqual(2);

      const bySku = await request(app.getHttpServer())
        .get(`/api/v1/inventory?search=INV-SIMPLE-${runId}`)
        .set('Authorization', auth(adminToken));
      expect(bySku.body.items.some((i: any) => i.id === simpleInventoryId)).toBe(true);
    });
  });

  describe('Adjustment', () => {
    let itemId: string;

    beforeAll(async () => {
      const item = await prisma.inventoryItem.create({
        data: { storeId, warehouseId: warehouseAId, productId: simpleProductId, onHandQuantity: 20, availableQuantity: 20, lowStockThreshold: 5 },
      });
      itemId = item.id;
    });

    it('adjusts stock in', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/adjust')
        .set('Authorization', auth(adminToken))
        .send({ inventoryItemId: itemId, quantity: 5, reason: 'Received new stock' });
      expect(res.status).toBe(201);
      expect(res.body.onHandQuantity).toBe(25);
      expect(res.body.availableQuantity).toBe(25);
    });

    it('adjusts stock out', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/adjust')
        .set('Authorization', auth(adminToken))
        .send({ inventoryItemId: itemId, quantity: -3, reason: 'Damaged units' });
      expect(res.status).toBe(201);
      expect(res.body.onHandQuantity).toBe(22);
      expect(res.body.availableQuantity).toBe(22);
    });

    it('rejects an adjustment that would push stock negative, leaving the DB unchanged', async () => {
      const before = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/adjust')
        .set('Authorization', auth(adminToken))
        .send({ inventoryItemId: itemId, quantity: -999, reason: 'Too much' });
      expect(res.status).toBe(409);

      const after = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
      expect(after?.onHandQuantity).toBe(before?.onHandQuantity);
      expect(after?.availableQuantity).toBe(before?.availableQuantity);
    });

    it('rejects a zero-quantity adjustment', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/adjust')
        .set('Authorization', auth(adminToken))
        .send({ inventoryItemId: itemId, quantity: 0, reason: 'No-op' });
      expect(res.status).toBe(400);
    });

    it('records an accurate, immutable transaction history', async () => {
      const transactions = await prisma.inventoryTransaction.findMany({
        where: { inventoryItemId: itemId },
        orderBy: { createdAt: 'asc' },
      });
      expect(transactions).toHaveLength(2);
      expect(transactions[0]).toEqual(expect.objectContaining({ type: 'STOCK_IN', quantity: 5, previousQuantity: 20, newQuantity: 25 }));
      expect(transactions[1]).toEqual(expect.objectContaining({ type: 'STOCK_OUT', quantity: -3, previousQuantity: 25, newQuantity: 22 }));

      const historyRes = await request(app.getHttpServer())
        .get(`/api/v1/inventory/${itemId}/transactions`)
        .set('Authorization', auth(adminToken));
      expect(historyRes.status).toBe(200);
      expect(historyRes.body.items).toHaveLength(2);
      expect(historyRes.body.items[0].type).toBe('STOCK_OUT'); // newest first
    });

    it('detects low stock and out-of-stock state', async () => {
      const lowStockItem = await prisma.inventoryItem.create({
        data: { storeId, warehouseId: warehouseBId, productId: simpleProductId, variantId, onHandQuantity: 4, availableQuantity: 4, lowStockThreshold: 10 },
      });
      const detail = await request(app.getHttpServer())
        .get(`/api/v1/inventory/${lowStockItem.id}`)
        .set('Authorization', auth(adminToken));
      expect(detail.body.isLowStock).toBe(true);
      expect(detail.body.isOutOfStock).toBe(false);

      const lowStockList = await request(app.getHttpServer())
        .get(`/api/v1/inventory?lowStock=true&warehouseId=${warehouseBId}`)
        .set('Authorization', auth(adminToken));
      expect(lowStockList.body.items.some((i: any) => i.id === lowStockItem.id)).toBe(true);

      await request(app.getHttpServer())
        .post('/api/v1/inventory/adjust')
        .set('Authorization', auth(adminToken))
        .send({ inventoryItemId: lowStockItem.id, quantity: -4, reason: 'Sold out' });

      const outOfStockList = await request(app.getHttpServer())
        .get(`/api/v1/inventory?outOfStock=true&warehouseId=${warehouseBId}`)
        .set('Authorization', auth(adminToken));
      expect(outOfStockList.body.items.some((i: any) => i.id === lowStockItem.id)).toBe(true);
    });
  });

  describe('Reservations', () => {
    let itemId: string;

    beforeAll(async () => {
      const item = await prisma.inventoryItem.create({
        data: { storeId, warehouseId: warehouseBId, productId: simpleProductId, onHandQuantity: 10, availableQuantity: 10 },
      });
      itemId = item.id;
    });

    it('reserves available stock', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/reservations')
        .set('Authorization', auth(adminToken))
        .send({ inventoryItemId: itemId, quantity: 6, reference: 'order-fixture-1' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ACTIVE');

      const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
      expect(item?.availableQuantity).toBe(4);
      expect(item?.reservedQuantity).toBe(6);
    });

    it('rejects a reservation exceeding available stock, leaving the DB unchanged', async () => {
      const before = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/reservations')
        .set('Authorization', auth(adminToken))
        .send({ inventoryItemId: itemId, quantity: 5 });
      expect(res.status).toBe(409);

      const after = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
      expect(after?.availableQuantity).toBe(before?.availableQuantity);
      expect(after?.reservedQuantity).toBe(before?.reservedQuantity);
    });

    it('releases a reservation, restoring available stock', async () => {
      const reserveRes = await request(app.getHttpServer())
        .post('/api/v1/inventory/reservations')
        .set('Authorization', auth(adminToken))
        .send({ inventoryItemId: itemId, quantity: 2 });
      const reservationId = reserveRes.body.id;

      const releaseRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/reservations/${reservationId}/release`)
        .set('Authorization', auth(adminToken));
      expect(releaseRes.status).toBe(201);
      expect(releaseRes.body.status).toBe('RELEASED');

      const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
      expect(item?.reservedQuantity).toBe(6); // back to just the first reservation
    });

    it('releasing an already-released reservation is idempotent, not an error', async () => {
      const reserveRes = await request(app.getHttpServer())
        .post('/api/v1/inventory/reservations')
        .set('Authorization', auth(adminToken))
        .send({ inventoryItemId: itemId, quantity: 1 });
      const reservationId = reserveRes.body.id;

      const first = await request(app.getHttpServer())
        .post(`/api/v1/inventory/reservations/${reservationId}/release`)
        .set('Authorization', auth(adminToken));
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer())
        .post(`/api/v1/inventory/reservations/${reservationId}/release`)
        .set('Authorization', auth(adminToken));
      expect(second.status).toBe(201);
      expect(second.body.status).toBe('RELEASED');
    });

    it('consumes a reservation (ACTIVE -> COMMITTED) without moving reserved/available quantities', async () => {
      const reserveRes = await request(app.getHttpServer())
        .post('/api/v1/inventory/reservations')
        .set('Authorization', auth(adminToken))
        .send({ inventoryItemId: itemId, quantity: 2 });
      const reservationId = reserveRes.body.id;
      const before = await prisma.inventoryItem.findUnique({ where: { id: itemId } });

      const consumeRes = await request(app.getHttpServer())
        .post(`/api/v1/inventory/reservations/${reservationId}/consume`)
        .set('Authorization', auth(adminToken));
      expect(consumeRes.status).toBe(201);
      expect(consumeRes.body.status).toBe('COMMITTED');

      const after = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
      expect(after?.availableQuantity).toBe(before?.availableQuantity);
      expect(after?.reservedQuantity).toBe(before?.reservedQuantity);
      expect(after?.committedQuantity).toBe(2);
    });

    it('rejects releasing a COMMITTED reservation', async () => {
      const committed = await prisma.stockReservation.findFirst({ where: { inventoryItemId: itemId, status: 'COMMITTED' } });
      const res = await request(app.getHttpServer())
        .post(`/api/v1/inventory/reservations/${committed!.id}/release`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(409);
    });

    it('consuming an already-COMMITTED reservation is idempotent (does not re-apply the commit)', async () => {
      // PHASE 2F CORRECTION: consume() on an already-COMMITTED reservation is
      // now deliberately idempotent (returns the existing result, 201) rather
      // than a 409 - symmetric with release()'s existing idempotency, and one
      // of the two explicitly-allowed behaviors for a repeated commit. The
      // key correctness property is that committedQuantity is NOT incremented
      // a second time.
      const committed = await prisma.stockReservation.findFirst({ where: { inventoryItemId: itemId, status: 'COMMITTED' } });
      const before = await prisma.inventoryItem.findUnique({ where: { id: itemId } });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/inventory/reservations/${committed!.id}/consume`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('COMMITTED');

      const after = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
      expect(after?.committedQuantity).toBe(before?.committedQuantity);
      expect(after?.reservedQuantity).toBe(before?.reservedQuantity);
    });

    it('rejects consuming a RELEASED reservation (genuine invalid transition, not idempotent)', async () => {
      const released = await prisma.stockReservation.findFirst({ where: { inventoryItemId: itemId, status: 'RELEASED' } });
      const res = await request(app.getHttpServer())
        .post(`/api/v1/inventory/reservations/${released!.id}/consume`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(409);
    });

    it('verifies the reservedQuantity accounting model directly: SUM(ACTIVE + COMMITTED reservation quantities) == InventoryItem.reservedQuantity', async () => {
      const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
      const heldReservations = await prisma.stockReservation.aggregate({
        where: { inventoryItemId: itemId, status: { in: ['ACTIVE', 'COMMITTED'] } },
        _sum: { quantity: true },
      });
      expect(heldReservations._sum.quantity ?? 0).toBe(item.reservedQuantity);
      expect(item.availableQuantity).toBe(item.onHandQuantity - item.reservedQuantity);
    });
  });

  describe('Transfers', () => {
    it('transfers stock between warehouses atomically', async () => {
      // Dedicated fixture product (not simpleProductId/variantId) so this
      // identity can't collide with rows created by earlier describes.
      const transferProduct = await prisma.product.create({
        data: { storeId, name: `Transfer Atomic Fixture ${runId}`, slug: `transfer-atomic-fixture-${runId}`, basePrice: '1.00', sku: `TRANSFER-ATOMIC-${runId}` },
      });
      const source = await prisma.inventoryItem.create({
        data: { storeId, warehouseId: warehouseAId, productId: transferProduct.id, onHandQuantity: 10, availableQuantity: 10 },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/transfer')
        .set('Authorization', auth(adminToken))
        .send({ sourceWarehouseId: warehouseAId, destinationWarehouseId: warehouseBId, productId: transferProduct.id, quantity: 4 });
      expect(res.status).toBe(201);
      expect(res.body.source.onHandQuantity).toBe(6);
      expect(res.body.destination.onHandQuantity).toBe(4);

      const sourceTx = await prisma.inventoryTransaction.findFirst({ where: { inventoryItemId: source.id, type: 'TRANSFER' } });
      const destTx = await prisma.inventoryTransaction.findFirst({ where: { inventoryItemId: res.body.destination.id, type: 'TRANSFER' } });
      expect(sourceTx?.quantity).toBe(-4);
      expect(destTx?.quantity).toBe(4);
      expect(sourceTx?.reference).toBe(destTx?.reference);
    });

    it('rejects a transfer with insufficient source stock, leaving both sides unchanged', async () => {
      const source = await prisma.inventoryItem.create({
        data: { storeId, warehouseId: warehouseAId, productId: simpleProductId, onHandQuantity: 3, availableQuantity: 3 },
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/transfer')
        .set('Authorization', auth(adminToken))
        .send({ sourceWarehouseId: warehouseAId, destinationWarehouseId: warehouseBId, productId: simpleProductId, quantity: 100 });
      expect(res.status).toBe(409);

      const after = await prisma.inventoryItem.findUnique({ where: { id: source.id } });
      expect(after?.onHandQuantity).toBe(3);
    });

    it('rejects a transfer to the same warehouse', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/transfer')
        .set('Authorization', auth(adminToken))
        .send({ sourceWarehouseId: warehouseAId, destinationWarehouseId: warehouseAId, productId: simpleProductId, quantity: 1 });
      expect(res.status).toBe(400);
    });

    it('lazily creates the destination inventory item if none existed', async () => {
      const freshProduct = await prisma.product.create({
        data: { storeId, name: `Transfer Fixture ${runId}`, slug: `transfer-fixture-${runId}`, basePrice: '1.00', sku: `TRANSFER-FIX-${runId}` },
      });
      await prisma.inventoryItem.create({
        data: { storeId, warehouseId: warehouseAId, productId: freshProduct.id, onHandQuantity: 8, availableQuantity: 8 },
      });
      const existingDest = await prisma.inventoryItem.findFirst({ where: { warehouseId: warehouseBId, productId: freshProduct.id } });
      expect(existingDest).toBeNull();

      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/transfer')
        .set('Authorization', auth(adminToken))
        .send({ sourceWarehouseId: warehouseAId, destinationWarehouseId: warehouseBId, productId: freshProduct.id, quantity: 3 });
      expect(res.status).toBe(201);

      const newDest = await prisma.inventoryItem.findFirst({ where: { warehouseId: warehouseBId, productId: freshProduct.id } });
      expect(newDest?.onHandQuantity).toBe(3);
    });
  });

  describe('Concurrency (real PostgreSQL races)', () => {
    it('Test 1 - concurrent decrement: only one of two simultaneous -7 adjustments succeeds', async () => {
      const item = await prisma.inventoryItem.create({
        data: { storeId, warehouseId: warehouseAId, productId: simpleProductId, onHandQuantity: 10, availableQuantity: 10 },
      });

      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/inventory/adjust')
          .set('Authorization', auth(adminToken))
          .send({ inventoryItemId: item.id, quantity: -7, reason: 'Race A' }),
        request(app.getHttpServer())
          .post('/api/v1/inventory/adjust')
          .set('Authorization', auth(adminToken))
          .send({ inventoryItemId: item.id, quantity: -7, reason: 'Race B' }),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      const final = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
      expect(final?.onHandQuantity).toBe(3);
      expect(final?.availableQuantity).toBe(3);
      expect(final!.onHandQuantity).toBeGreaterThanOrEqual(0);

      const successfulOutTransactions = await prisma.inventoryTransaction.count({
        where: { inventoryItemId: item.id, type: 'STOCK_OUT' },
      });
      expect(successfulOutTransactions).toBe(1);
    });

    it('Test 2 - concurrent reservation: only one of two simultaneous 7-unit reservations succeeds', async () => {
      const item = await prisma.inventoryItem.create({
        data: { storeId, warehouseId: warehouseAId, productId: simpleProductId, onHandQuantity: 10, availableQuantity: 10 },
      });

      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/inventory/reservations')
          .set('Authorization', auth(adminToken))
          .send({ inventoryItemId: item.id, quantity: 7 }),
        request(app.getHttpServer())
          .post('/api/v1/inventory/reservations')
          .set('Authorization', auth(adminToken))
          .send({ inventoryItemId: item.id, quantity: 7 }),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      const final = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
      expect(final?.reservedQuantity).toBe(7);
      expect(final?.availableQuantity).toBe(3);

      const activeReservations = await prisma.stockReservation.count({ where: { inventoryItemId: item.id, status: 'ACTIVE' } });
      expect(activeReservations).toBe(1);
    });

    it('Test 3 - concurrent transfer: only one of two simultaneous 4-unit transfers succeeds, source never negative', async () => {
      // Dedicated fixture product: simpleProductId already has multiple
      // (warehouseA, variantId=null) rows from earlier describes in this file
      // (each one a legitimate, distinct row under the documented NULL-uniqueness
      // gap - see Phase 2A/2F notes) - transfer()'s source lookup would then be
      // ambiguous about which one to target. That ambiguity can never arise
      // through real usage, since every row is created via initialize(), which
      // prevents a second row for the same identity with an advisory lock; a
      // dedicated product here reflects that real usage pattern.
      const transferProduct = await prisma.product.create({
        data: { storeId, name: `Concurrent Transfer Fixture ${runId}`, slug: `concurrent-transfer-fixture-${runId}`, basePrice: '1.00', sku: `CONCTRANSFER-${runId}` },
      });
      const source = await prisma.inventoryItem.create({
        data: { storeId, warehouseId: warehouseAId, productId: transferProduct.id, onHandQuantity: 5, availableQuantity: 5 },
      });

      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/inventory/transfer')
          .set('Authorization', auth(adminToken))
          .send({ sourceWarehouseId: warehouseAId, destinationWarehouseId: warehouseBId, productId: transferProduct.id, quantity: 4 }),
        request(app.getHttpServer())
          .post('/api/v1/inventory/transfer')
          .set('Authorization', auth(adminToken))
          .send({ sourceWarehouseId: warehouseAId, destinationWarehouseId: warehouseBId, productId: transferProduct.id, quantity: 4 }),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      const finalSource = await prisma.inventoryItem.findUnique({ where: { id: source.id } });
      expect(finalSource?.onHandQuantity).toBe(1);
      expect(finalSource!.onHandQuantity).toBeGreaterThanOrEqual(0);
    });

    it('Test 4 - concurrent initialization: only one InventoryItem is created for the same identity', async () => {
      const freshProduct = await prisma.product.create({
        data: { storeId, name: `Concurrent Init Fixture ${runId}`, slug: `concurrent-init-fixture-${runId}`, basePrice: '1.00', sku: `CONCINIT-${runId}` },
      });

      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/inventory')
          .set('Authorization', auth(adminToken))
          .send({ warehouseId: warehouseAId, productId: freshProduct.id, quantity: 10 }),
        request(app.getHttpServer())
          .post('/api/v1/inventory')
          .set('Authorization', auth(adminToken))
          .send({ warehouseId: warehouseAId, productId: freshProduct.id, quantity: 20 }),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      const rows = await prisma.inventoryItem.findMany({ where: { warehouseId: warehouseAId, productId: freshProduct.id } });
      expect(rows).toHaveLength(1);

      const initTransactions = await prisma.inventoryTransaction.count({ where: { inventoryItemId: rows[0].id, type: 'INITIAL_STOCK' } });
      expect(initTransactions).toBe(1);
    });

    it('Test 5 - concurrent commit: two simultaneous consume() calls on the same reservation apply exactly once', async () => {
      const item = await prisma.inventoryItem.create({
        data: { storeId, warehouseId: warehouseAId, productId: simpleProductId, onHandQuantity: 10, availableQuantity: 4, reservedQuantity: 6 },
      });
      const reservation = await prisma.stockReservation.create({
        data: { storeId, inventoryItemId: item.id, quantity: 6, status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) },
      });

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post(`/api/v1/inventory/reservations/${reservation.id}/consume`).set('Authorization', auth(adminToken)),
        request(app.getHttpServer()).post(`/api/v1/inventory/reservations/${reservation.id}/consume`).set('Authorization', auth(adminToken)),
      ]);

      // Both are allowed to report success (consume is deliberately idempotent -
      // see the dedicated idempotency test above) - what matters is that the
      // underlying stock effect happened exactly once, not twice.
      expect([a.status, b.status]).toEqual([201, 201]);
      expect([a.body.status, b.body.status]).toEqual(['COMMITTED', 'COMMITTED']);

      const finalItem = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(finalItem.committedQuantity).toBe(6); // not 12 - the second call must not re-apply the increment
      expect(finalItem.reservedQuantity).toBe(6); // unchanged by consume, per the Model B semantics

      const commitTransactions = await prisma.inventoryTransaction.count({
        where: { inventoryItemId: item.id, reason: { contains: 'Reservation consumed' } },
      });
      expect(commitTransactions).toBe(1); // exactly one ledger entry, not two
    });

    it('Test 6 - concurrent release: two simultaneous release() calls on the same reservation credit stock exactly once', async () => {
      const item = await prisma.inventoryItem.create({
        data: { storeId, warehouseId: warehouseAId, productId: simpleProductId, onHandQuantity: 10, availableQuantity: 4, reservedQuantity: 6 },
      });
      const reservation = await prisma.stockReservation.create({
        data: { storeId, inventoryItemId: item.id, quantity: 6, status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) },
      });

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post(`/api/v1/inventory/reservations/${reservation.id}/release`).set('Authorization', auth(adminToken)),
        request(app.getHttpServer()).post(`/api/v1/inventory/reservations/${reservation.id}/release`).set('Authorization', auth(adminToken)),
      ]);

      expect([a.status, b.status]).toEqual([201, 201]);
      expect([a.body.status, b.body.status]).toEqual(['RELEASED', 'RELEASED']);

      const finalItem = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(finalItem.availableQuantity).toBe(10); // not 16 - the second call must not re-credit availability
      expect(finalItem.reservedQuantity).toBe(0); // not -6

      const releaseTransactions = await prisma.inventoryTransaction.count({ where: { inventoryItemId: item.id, type: 'RELEASE' } });
      expect(releaseTransactions).toBe(1);
    });
  });

  describe('Cross-tenant security (IDOR/BOLA)', () => {
    let storeAItemId: string;
    let storeAReservationId: string;

    beforeAll(async () => {
      const item = await prisma.inventoryItem.create({
        data: { storeId, warehouseId: warehouseAId, productId: simpleProductId, onHandQuantity: 20, availableQuantity: 20 },
      });
      storeAItemId = item.id;
      const reservation = await prisma.stockReservation.create({
        data: { storeId, inventoryItemId: item.id, quantity: 2, status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) },
      });
      storeAReservationId = reservation.id;
      await prisma.inventoryItem.update({ where: { id: item.id }, data: { availableQuantity: 18, reservedQuantity: 2 } });
    });

    it('Store B cannot GET Store A inventory item', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/inventory/${storeAItemId}`)
        .set('Authorization', auth(storeBToken));
      expect(res.status).toBe(404);
    });

    it('Store B cannot adjust Store A inventory', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/adjust')
        .set('Authorization', auth(storeBToken))
        .send({ inventoryItemId: storeAItemId, quantity: 5, reason: 'Hijack attempt' });
      expect(res.status).toBe(404);

      const stillOriginal = await prisma.inventoryItem.findUnique({ where: { id: storeAItemId } });
      expect(stillOriginal?.onHandQuantity).toBe(20);
    });

    it("Store B cannot transfer using Store A's warehouse/product", async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/transfer')
        .set('Authorization', auth(storeBToken))
        .send({ sourceWarehouseId: warehouseAId, destinationWarehouseId: storeBWarehouseId, productId: simpleProductId, quantity: 1 });
      expect(res.status).toBe(404);
    });

    it("Store B cannot reserve against Store A's inventory item", async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/reservations')
        .set('Authorization', auth(storeBToken))
        .send({ inventoryItemId: storeAItemId, quantity: 1 });
      expect(res.status).toBe(404);
    });

    it("Store B cannot release Store A's reservation", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/inventory/reservations/${storeAReservationId}/release`)
        .set('Authorization', auth(storeBToken));
      expect(res.status).toBe(404);

      const stillActive = await prisma.stockReservation.findUnique({ where: { id: storeAReservationId } });
      expect(stillActive?.status).toBe('ACTIVE');
    });

    it("Store B cannot consume Store A's reservation", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/inventory/reservations/${storeAReservationId}/consume`)
        .set('Authorization', auth(storeBToken));
      expect(res.status).toBe(404);
    });

    it("Store B's own product/warehouse cannot be referenced together with Store A's ids in one transfer", async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/transfer')
        .set('Authorization', auth(adminToken))
        .send({ sourceWarehouseId: warehouseAId, destinationWarehouseId: warehouseBId, productId: storeBProductId, quantity: 1 });
      expect(res.status).toBe(404);
    });
  });

  describe('PostgreSQL invariant verification (whole table, not just this run\'s rows)', () => {
    it(
      'every InventoryItem satisfies onHand/reserved/available invariants and the reserved-quantity accounting model',
      async () => {
        const items = await prisma.inventoryItem.findMany();
        expect(items.length).toBeGreaterThan(0);

        for (const item of items) {
          expect(item.onHandQuantity).toBeGreaterThanOrEqual(0);
          expect(item.reservedQuantity).toBeGreaterThanOrEqual(0);
          expect(item.availableQuantity).toBeGreaterThanOrEqual(0);
          expect(item.availableQuantity).toBe(item.onHandQuantity - item.reservedQuantity);
          expect(item.committedQuantity).toBeLessThanOrEqual(item.reservedQuantity);
        }

        // Model B, checked directly per item: reservedQuantity must equal the sum
        // of ACTIVE + COMMITTED reservation quantities for that item - not just
        // ACTIVE ones. This is the actual PostgreSQL-level proof that the
        // accounting model is internally consistent, not merely asserted in prose.
        const grouped = await prisma.stockReservation.groupBy({
          by: ['inventoryItemId'],
          where: { status: { in: ['ACTIVE', 'COMMITTED'] } },
          _sum: { quantity: true },
        });
        const heldByItemId = new Map(grouped.map((g) => [g.inventoryItemId, g._sum.quantity ?? 0]));

        for (const item of items) {
          expect(item.reservedQuantity).toBe(heldByItemId.get(item.id) ?? 0);
        }
      },
      // This scans the ENTIRE InventoryItem table across the whole shared,
      // persistent dev database (every phase's testing, all session), not
      // just this run's own rows - its real running time grows with
      // accumulated test history, not with anything this phase changed (the
      // same pattern already independently fixed for phase6-fulfillment's
      // and phase8-reviews-wishlist's own whole-table scans). Raised per
      // Jest's own recommended practice; no assertion changed.
      20000,
    );
  });
});
