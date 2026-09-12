import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppConfig } from '../src/config/configuration';
import { slugify } from '../src/common/utils/slug.util';

describe('Peshani Attributes & Attribute Values (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let customerToken: string;
  let storeBToken: string;
  let storeId: string;

  const runId = Date.now();
  const colorName = `Color ${runId}`;
  const materialName = `Material ${runId}`;
  const materialSlug = `material-${runId}`;

  let colorAttributeId: string;
  let storeBAttributeId: string;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peshani.example';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const customerEmail = `attr.customer.${runId}@example.com`;
  const customerPassword = 'SuperSecret123!';

  const auth = (token: string) => `Bearer ${token}`;

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

    // Store B: second tenant for cross-tenant tests (see catalog.e2e-spec.ts for why the
    // token is minted directly rather than through /auth/login).
    const storeB = await prisma.store.create({ data: { slug: `store-b-attr-${runId}`, name: 'Store B', isActive: true } });
    const perms = await prisma.permission.findMany({
      where: { key: { in: ['attribute.read', 'attribute.update', 'attribute_value.read', 'attribute_value.update'] } },
    });
    const roleB = await prisma.role.create({ data: { storeId: storeB.id, name: 'ADMIN' } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: roleB.id, permissionId: p.id })) });
    const userB = await prisma.user.create({
      data: {
        storeId: storeB.id,
        email: `storeb.attr.${runId}@example.com`,
        passwordHash: await argon2.hash('irrelevant'),
        type: 'ADMIN',
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.userRole.create({ data: { userId: userB.id, roleId: roleB.id } });
    const storeBAttribute = await prisma.attribute.create({
      data: { storeId: storeB.id, name: 'Store B Attribute', slug: `store-b-attribute-${runId}` },
    });
    storeBAttributeId = storeBAttribute.id;

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

  describe('Attributes', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/attributes');
      expect(res.status).toBe(401);
    });

    it('rejects a plain customer', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/attributes').set('Authorization', auth(customerToken));
      expect(res.status).toBe(403);
    });

    it('creates an attribute with an auto-derived slug', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/attributes')
        .set('Authorization', auth(adminToken))
        .send({ name: colorName, type: 'COLOR' });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe(slugify(colorName));
      expect(res.body.type).toBe('COLOR');
      colorAttributeId = res.body.id;
    });

    it('creates an attribute with an explicit slug', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/attributes')
        .set('Authorization', auth(adminToken))
        .send({ name: materialName, slug: materialSlug });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe(materialSlug);
    });

    it('auto-suffixes the slug on a name collision', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/attributes')
        .set('Authorization', auth(adminToken))
        .send({ name: materialName });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe(`${slugify(materialName)}-2`);
    });

    it('rejects an explicitly supplied slug that already exists', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/attributes')
        .set('Authorization', auth(adminToken))
        .send({ name: 'Something Else', slug: materialSlug });
      expect(res.status).toBe(409);
    });

    it('lists attributes with pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/attributes?page=1&pageSize=2')
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.pagination).toEqual(expect.objectContaining({ page: 1, pageSize: 2 }));
    });

    it('searches by name', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/attributes?search=${encodeURIComponent(colorName)}`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.items.some((a: any) => a.name === colorName)).toBe(true);
    });

    it('filters by type', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/attributes?type=COLOR')
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.items.every((a: any) => a.type === 'COLOR')).toBe(true);
    });

    it('updates an attribute', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/attributes/${colorAttributeId}`)
        .set('Authorization', auth(adminToken))
        .send({ sortOrder: 5 });
      expect(res.status).toBe(200);
      expect(res.body.sortOrder).toBe(5);
    });

    it('changes status via the dedicated status endpoint', async () => {
      const attr = await prisma.attribute.create({ data: { storeId, name: `Toggle Attr ${runId}`, slug: `toggle-attr-${runId}` } });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/attributes/${attr.id}/status`)
        .set('Authorization', auth(adminToken))
        .send({ isActive: false });
      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(false);

      const auditEntry = await prisma.auditLog.findFirst({ where: { entityId: attr.id, action: 'AttributeStatusChanged' } });
      expect(auditEntry).toBeDefined();
    });

    it('refuses to delete an attribute used by a product', async () => {
      const attr = await prisma.attribute.create({ data: { storeId, name: `InUse Attr ${runId}`, slug: `inuse-attr-${runId}` } });
      const product = await prisma.product.create({
        data: { storeId, name: `Fixture Product ${runId}`, slug: `fixture-product-${runId}`, basePrice: '100.00' },
      });
      await prisma.productAttribute.create({ data: { productId: product.id, attributeId: attr.id } });

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/attributes/${attr.id}`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(409);
    });

    it('deletes an unused attribute (soft delete)', async () => {
      const attr = await prisma.attribute.create({ data: { storeId, name: `Disposable Attr ${runId}`, slug: `disposable-attr-${runId}` } });
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/attributes/${attr.id}`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);

      const getAfter = await request(app.getHttpServer())
        .get(`/api/v1/attributes/${attr.id}`)
        .set('Authorization', auth(adminToken));
      expect(getAfter.status).toBe(404);
    });
  });

  describe('Attribute values', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/attributes/${colorAttributeId}/values`);
      expect(res.status).toBe(401);
    });

    it('rejects a plain customer', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/attributes/${colorAttributeId}/values`)
        .set('Authorization', auth(customerToken));
      expect(res.status).toBe(403);
    });

    let blackValueId: string;

    it('creates a value with an auto-derived slug', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/attributes/${colorAttributeId}/values`)
        .set('Authorization', auth(adminToken))
        .send({ value: 'Black' });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe('black');
      blackValueId = res.body.id;
    });

    it('auto-suffixes the slug on a value collision within the same attribute', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/attributes/${colorAttributeId}/values`)
        .set('Authorization', auth(adminToken))
        .send({ value: 'Black' });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe('black-2');
    });

    it('rejects an explicitly supplied slug that already exists for this attribute', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/attributes/${colorAttributeId}/values`)
        .set('Authorization', auth(adminToken))
        .send({ value: 'Some Other Black', slug: 'black' });
      expect(res.status).toBe(409);
    });

    it('allows the SAME slug under a DIFFERENT attribute (scoped per-attribute, not per-store)', async () => {
      const otherAttr = await prisma.attribute.create({ data: { storeId, name: `Finish ${runId}`, slug: `finish-${runId}` } });
      const res = await request(app.getHttpServer())
        .post(`/api/v1/attributes/${otherAttr.id}/values`)
        .set('Authorization', auth(adminToken))
        .send({ value: 'Black' });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe('black');
    });

    it('lists values with pagination', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/attributes/${colorAttributeId}/values?page=1&pageSize=10`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.items.some((v: any) => v.value === 'Black')).toBe(true);
    });

    it('updates a value', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/attributes/${colorAttributeId}/values/${blackValueId}`)
        .set('Authorization', auth(adminToken))
        .send({ sortOrder: 1 });
      expect(res.status).toBe(200);
      expect(res.body.sortOrder).toBe(1);
    });

    it('changes value status', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/attributes/${colorAttributeId}/values/${blackValueId}/status`)
        .set('Authorization', auth(adminToken))
        .send({ isActive: true });
      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(true);
    });

    it('reorders values', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/attributes/${colorAttributeId}/values/reorder`)
        .set('Authorization', auth(adminToken))
        .send({ items: [{ id: blackValueId, sortOrder: 9 }] });
      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(1);
    });

    it('refuses to delete a value used by a variant', async () => {
      const product = await prisma.product.create({
        data: { storeId, name: `Value Fixture Product ${runId}`, slug: `value-fixture-product-${runId}`, basePrice: '100.00' },
      });
      const variant = await prisma.productVariant.create({
        data: { storeId, productId: product.id, sku: `SKU-${runId}`, price: '100.00', combinationKey: blackValueId },
      });
      await prisma.productVariantAttributeValue.create({ data: { variantId: variant.id, attributeValueId: blackValueId } });

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/attributes/${colorAttributeId}/values/${blackValueId}`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(409);
    });

    it('deletes an unused value (soft delete)', async () => {
      const value = await prisma.attributeValue.create({
        data: { attributeId: colorAttributeId, value: 'Disposable', slug: `disposable-value-${runId}` },
      });
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/attributes/${colorAttributeId}/values/${value.id}`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
    });
  });

  describe('Cross-tenant security (IDOR/BOLA)', () => {
    it('Store B cannot GET Store A attribute by id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/attributes/${colorAttributeId}`)
        .set('Authorization', auth(storeBToken));
      expect(res.status).toBe(404);
    });

    it('Store B cannot PATCH Store A attribute', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/attributes/${colorAttributeId}`)
        .set('Authorization', auth(storeBToken))
        .send({ name: 'Hijacked' });
      expect(res.status).toBe(404);
    });

    it('Store A cannot access Store B attribute (reverse direction)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/attributes/${storeBAttributeId}`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(404);
    });

    it('Store B cannot list values under a Store A attribute', async () => {
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/attributes/${colorAttributeId}/values`)
        .set('Authorization', auth(storeBToken));
      expect(getRes.status).toBe(404);
    });

    it("Store B's role has no create permission at all, so it can't even attempt to attach a value (403 before the store-scope check runs)", async () => {
      const postRes = await request(app.getHttpServer())
        .post(`/api/v1/attributes/${colorAttributeId}/values`)
        .set('Authorization', auth(storeBToken))
        .send({ value: 'Hijacked Value' });
      expect(postRes.status).toBe(403);
    });
  });
});
