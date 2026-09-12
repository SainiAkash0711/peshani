import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppConfig } from '../src/config/configuration';

describe('Peshani Warehouses (e2e)', () => {
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
  const customerEmail = `warehouse.customer.${runId}@example.com`;
  const customerPassword = 'SuperSecret123!';

  let storeAWarehouseId: string;

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

    const storeB = await prisma.store.create({ data: { slug: `store-b-warehouse-${runId}`, name: 'Store B', isActive: true } });
    const perms = await prisma.permission.findMany({ where: { key: { in: ['warehouse.read', 'warehouse.update'] } } });
    const roleB = await prisma.role.create({ data: { storeId: storeB.id, name: 'ADMIN' } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: roleB.id, permissionId: p.id })) });
    const userB = await prisma.user.create({
      data: {
        storeId: storeB.id,
        email: `storeb.warehouse.${runId}@example.com`,
        passwordHash: await argon2.hash('irrelevant'),
        type: 'ADMIN',
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.userRole.create({ data: { userId: userB.id, roleId: roleB.id } });

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

  it('rejects an unauthenticated request', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/warehouses');
    expect(res.status).toBe(401);
  });

  it('rejects a plain customer', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/warehouses').set('Authorization', auth(customerToken));
    expect(res.status).toBe(403);
  });

  it('creates a warehouse', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set('Authorization', auth(adminToken))
      .send({ name: `Main Warehouse ${runId}`, code: `main-${runId}`, city: 'Delhi' });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe(`MAIN-${runId}`.toUpperCase());
    storeAWarehouseId = res.body.id;
  });

  it('rejects a duplicate warehouse code', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set('Authorization', auth(adminToken))
      .send({ name: 'Duplicate', code: `main-${runId}` });
    expect(res.status).toBe(409);
  });

  it('lists warehouses with pagination and search', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/warehouses?search=${encodeURIComponent(`Main Warehouse ${runId}`)}`)
      .set('Authorization', auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.items.some((w: any) => w.id === storeAWarehouseId)).toBe(true);
    expect(res.body.pagination).toBeDefined();
  });

  it('gets a warehouse by id', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/warehouses/${storeAWarehouseId}`)
      .set('Authorization', auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(storeAWarehouseId);
  });

  it('updates a warehouse', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/warehouses/${storeAWarehouseId}`)
      .set('Authorization', auth(adminToken))
      .send({ city: 'Mumbai' });
    expect(res.status).toBe(200);
    expect(res.body.city).toBe('Mumbai');
  });

  it('changes status via the dedicated status endpoint', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/warehouses/${storeAWarehouseId}/status`)
      .set('Authorization', auth(adminToken))
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);

    const auditEntry = await prisma.auditLog.findFirst({ where: { entityId: storeAWarehouseId, action: 'WarehouseStatusChanged' } });
    expect(auditEntry).toBeDefined();

    // restore for later tests
    await request(app.getHttpServer())
      .patch(`/api/v1/warehouses/${storeAWarehouseId}/status`)
      .set('Authorization', auth(adminToken))
      .send({ isActive: true });
  });

  it('refuses to delete a warehouse holding stock', async () => {
    const product = await prisma.product.create({
      data: { storeId, name: `Warehouse Fixture Product ${runId}`, slug: `warehouse-fixture-product-${runId}`, basePrice: '10.00', sku: `WHFIX-${runId}` },
    });
    await prisma.inventoryItem.create({
      data: { storeId, warehouseId: storeAWarehouseId, productId: product.id, onHandQuantity: 5, availableQuantity: 5 },
    });

    const res = await request(app.getHttpServer())
      .delete(`/api/v1/warehouses/${storeAWarehouseId}`)
      .set('Authorization', auth(adminToken));
    expect(res.status).toBe(409);
  });

  it('deletes an empty warehouse (soft delete)', async () => {
    const disposable = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set('Authorization', auth(adminToken))
      .send({ name: 'Disposable Warehouse', code: `disposable-${runId}` });
    expect(disposable.status).toBe(201);

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/warehouses/${disposable.body.id}`)
      .set('Authorization', auth(adminToken));
    expect(del.status).toBe(200);

    const getAfter = await request(app.getHttpServer())
      .get(`/api/v1/warehouses/${disposable.body.id}`)
      .set('Authorization', auth(adminToken));
    expect(getAfter.status).toBe(404);
  });

  describe('Cross-tenant security (IDOR/BOLA)', () => {
    it('Store B cannot GET Store A warehouse', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/warehouses/${storeAWarehouseId}`)
        .set('Authorization', auth(storeBToken));
      expect(res.status).toBe(404);
    });

    it('Store B cannot PATCH Store A warehouse', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/warehouses/${storeAWarehouseId}`)
        .set('Authorization', auth(storeBToken))
        .send({ name: 'Hijacked' });
      expect(res.status).toBe(404);

      const stillOriginal = await prisma.warehouse.findUnique({ where: { id: storeAWarehouseId } });
      expect(stillOriginal?.name).not.toBe('Hijacked');
    });

    it("Store B's role has no delete permission at all, so delete is rejected at the permission layer", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/warehouses/${storeAWarehouseId}`)
        .set('Authorization', auth(storeBToken));
      expect(res.status).toBe(403);
    });
  });
});
