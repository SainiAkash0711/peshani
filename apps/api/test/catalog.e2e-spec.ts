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

describe('Peshani Catalog - Categories & Brands (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let customerToken: string;
  let storeBToken: string;

  // Every name/slug created against the real dev database below is suffixed
  // with this run id so repeated test runs never collide with leftover rows
  // from a previous run (categories/brands are soft-deleted, not purged, so
  // their slugs stay reserved - see the note on CategoriesService.slugExists).
  const runId = Date.now();
  const electronicsName = `Electronics ${runId}`;
  const mobilePhonesName = `Mobile Phones ${runId}`;
  const mobilePhonesSlug = `mobile-phones-${runId}`;
  const smartphonesName = `Smartphones ${runId}`;
  const nikeName = `Nike ${runId}`;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peshani.example';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const customerEmail = `catalog.customer.${runId}@example.com`;
  const customerPassword = 'SuperSecret123!';

  // Category/brand ids created by Store A (the seeded "peshani" store), reused
  // across tests further down (e.g. the cross-tenant security block).
  let storeACategoryId: string;
  let storeABrandId: string;
  let storeBCategoryId: string;

  const auth = (token: string) => `Bearer ${token}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: customerEmail, password: customerPassword });
    const customerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: customerEmail, password: customerPassword });
    customerToken = customerLogin.body.accessToken;

    // --- Store B: a second tenant, used only for the cross-tenant IDOR tests. ---
    // NOTE: Phase 1's /auth/login always resolves the store via
    // StoreSettingsService.getDefaultStore() (single-store today; real
    // multi-store login routing is future white-label work per the roadmap).
    // So a Store B user can't log in through the public endpoint yet - we
    // mint their access token directly with the same JwtService/secret the
    // real login flow uses, which is enough to test store-scoping in
    // isolation from that unrelated limitation.
    const storeB = await prisma.store.create({
      data: { slug: `store-b-${Date.now()}`, name: 'Store B', isActive: true },
    });
    const catalogPermissions = await prisma.permission.findMany({
      where: { key: { in: ['category.read', 'category.update', 'category.delete', 'brand.read', 'brand.update'] } },
    });
    const storeBRole = await prisma.role.create({ data: { storeId: storeB.id, name: 'ADMIN' } });
    await prisma.rolePermission.createMany({
      data: catalogPermissions.map((p) => ({ roleId: storeBRole.id, permissionId: p.id })),
    });
    const storeBUser = await prisma.user.create({
      data: {
        storeId: storeB.id,
        email: `storeb.admin.${Date.now()}@example.com`,
        passwordHash: await argon2.hash('irrelevant-not-used-to-login'),
        type: 'ADMIN',
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.userRole.create({ data: { userId: storeBUser.id, roleId: storeBRole.id } });

    const storeBCategory = await prisma.category.create({
      data: { storeId: storeB.id, name: 'Store B Category', slug: 'store-b-category' },
    });
    storeBCategoryId = storeBCategory.id;

    const jwtService = app.get(JwtService);
    const configService = app.get(ConfigService<AppConfig, true>);
    storeBToken = await jwtService.signAsync(
      {
        sub: storeBUser.id,
        storeId: storeB.id,
        email: storeBUser.email,
        type: 'ADMIN',
        roles: ['ADMIN'],
        permissions: catalogPermissions.map((p) => p.key),
      },
      { secret: configService.get('jwt', { infer: true }).accessSecret, expiresIn: '15m', algorithm: 'HS256', issuer: 'peshani-api', audience: 'peshani-client' },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Categories', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/categories');
      expect(res.status).toBe(401);
    });

    it('rejects a plain customer', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', auth(customerToken));
      expect(res.status).toBe(403);
    });

    it('creates a root category with an auto-derived slug', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', auth(adminToken))
        .send({ name: electronicsName });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe(slugify(electronicsName));
      storeACategoryId = res.body.id;
    });

    it('creates a category with an explicit slug', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', auth(adminToken))
        .send({ name: mobilePhonesName, slug: mobilePhonesSlug });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe(mobilePhonesSlug);
    });

    it('auto-suffixes the slug on a name collision instead of rejecting', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', auth(adminToken))
        .send({ name: mobilePhonesName });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe(`${slugify(mobilePhonesName)}-2`);
    });

    it('rejects an explicitly supplied slug that already exists (409, not silently renamed)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', auth(adminToken))
        .send({ name: 'Phones Again', slug: mobilePhonesSlug });
      expect(res.status).toBe(409);
    });

    it('creates a child category under a valid parent in the same store', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', auth(adminToken))
        .send({ name: smartphonesName, parentId: storeACategoryId });
      expect(res.status).toBe(201);
      expect(res.body.parentId).toBe(storeACategoryId);
    });

    it('rejects a parent that does not exist', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', auth(adminToken))
        .send({ name: 'Orphan', parentId: '00000000-0000-0000-0000-000000000000' });
      expect(res.status).toBe(404);
    });

    it('rejects a parent belonging to another store', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', auth(adminToken))
        .send({ name: 'Cross Store Child', parentId: storeBCategoryId });
      expect(res.status).toBe(404);
    });

    it('returns a nested tree', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories/tree')
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      const electronics = res.body.find((c: any) => c.id === storeACategoryId);
      expect(electronics).toBeDefined();
      expect(electronics.children.some((c: any) => c.name === smartphonesName)).toBe(true);
    });

    it('lists categories with pagination metadata', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories?page=1&pageSize=2')
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      expect(res.body.pagination).toEqual(
        expect.objectContaining({ page: 1, pageSize: 2 }),
      );
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(4);
    });

    it('rejects an unreasonable pageSize', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories?pageSize=999999999')
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(400);
    });

    it('searches by name', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/categories?search=${encodeURIComponent(smartphonesName)}`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.items.some((c: any) => c.name === smartphonesName)).toBe(true);
    });

    it('filters by parentId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/categories?parentId=${storeACategoryId}`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.items.every((c: any) => c.parentId === storeACategoryId)).toBe(true);
    });

    it('updates a category', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${storeACategoryId}`)
        .set('Authorization', auth(adminToken))
        .send({ description: 'Consumer electronics and gadgets' });
      expect(res.status).toBe(200);
      expect(res.body.description).toBe('Consumer electronics and gadgets');
    });

    it('rejects a category becoming its own parent', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${storeACategoryId}`)
        .set('Authorization', auth(adminToken))
        .send({ parentId: storeACategoryId });
      expect(res.status).toBe(400);
    });

    it('rejects moving a category under its own descendant (cycle)', async () => {
      const smartphones = await prisma.category.findFirst({ where: { name: smartphonesName } });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${storeACategoryId}`)
        .set('Authorization', auth(adminToken))
        .send({ parentId: smartphones!.id });
      expect(res.status).toBe(409);
    });

    it('changes status via the dedicated status endpoint (audited separately from update)', async () => {
      const category = await prisma.category.create({
        data: {
          storeId: (await prisma.category.findUnique({ where: { id: storeACategoryId } }))!.storeId,
          name: 'Toggle Me',
          slug: `toggle-me-${Date.now()}`,
        },
      });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${category.id}/status`)
        .set('Authorization', auth(adminToken))
        .send({ isActive: false });
      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(false);

      const auditEntry = await prisma.auditLog.findFirst({
        where: { entityId: category.id, action: 'CategoryStatusChanged' },
      });
      expect(auditEntry).toBeDefined();
    });

    it('reorders categories', async () => {
      const mobilePhones = await prisma.category.findFirst({ where: { slug: mobilePhonesSlug } });
      const res = await request(app.getHttpServer())
        .patch('/api/v1/categories/reorder')
        .set('Authorization', auth(adminToken))
        .send({ items: [{ id: mobilePhones!.id, sortOrder: 5 }] });
      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(1);
    });

    it('refuses to delete a category that still has children', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/categories/${storeACategoryId}`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(409);
    });

    it('deletes a leaf category (soft delete - subsequently not found)', async () => {
      const leaf = await prisma.category.create({
        data: {
          storeId: (await prisma.category.findUnique({ where: { id: storeACategoryId } }))!.storeId,
          name: 'Disposable Leaf',
          slug: `disposable-leaf-${Date.now()}`,
        },
      });
      const del = await request(app.getHttpServer())
        .delete(`/api/v1/categories/${leaf.id}`)
        .set('Authorization', auth(adminToken));
      expect(del.status).toBe(200);

      const getAfter = await request(app.getHttpServer())
        .get(`/api/v1/categories/${leaf.id}`)
        .set('Authorization', auth(adminToken));
      expect(getAfter.status).toBe(404);

      const stillInDb = await prisma.category.findUnique({ where: { id: leaf.id } });
      expect(stillInDb?.deletedAt).not.toBeNull();
    });
  });

  describe('Brands', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/brands');
      expect(res.status).toBe(401);
    });

    it('rejects a plain customer', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/brands')
        .set('Authorization', auth(customerToken));
      expect(res.status).toBe(403);
    });

    it('creates a brand with an auto-derived slug', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/brands')
        .set('Authorization', auth(adminToken))
        .send({ name: nikeName, website: 'https://nike.example.com' });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe(slugify(nikeName));
      storeABrandId = res.body.id;
    });

    it('auto-suffixes the slug on a name collision', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/brands')
        .set('Authorization', auth(adminToken))
        .send({ name: nikeName });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe(`${slugify(nikeName)}-2`);
    });

    it('rejects an explicitly supplied slug that already exists', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/brands')
        .set('Authorization', auth(adminToken))
        .send({ name: 'Someone Else', slug: slugify(nikeName) });
      expect(res.status).toBe(409);
    });

    it('rejects an invalid website URL', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/brands')
        .set('Authorization', auth(adminToken))
        .send({ name: 'Bad URL Brand', website: 'not-a-url' });
      expect(res.status).toBe(400);
    });

    it('updates a brand', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/brands/${storeABrandId}`)
        .set('Authorization', auth(adminToken))
        .send({ description: 'Just do it.' });
      expect(res.status).toBe(200);
      expect(res.body.description).toBe('Just do it.');
    });

    it('changes status via the dedicated status endpoint', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/brands/${storeABrandId}/status`)
        .set('Authorization', auth(adminToken))
        .send({ isActive: false });
      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(false);
    });

    it('lists brands with pagination and search', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/brands?search=${encodeURIComponent(nikeName)}&page=1&pageSize=10`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.items.some((b: any) => b.name === nikeName)).toBe(true);
      expect(res.body.pagination).toBeDefined();
    });

    it('filters by status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/brands?status=inactive')
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.items.every((b: any) => b.isActive === false)).toBe(true);
    });

    it('deletes a brand (soft delete)', async () => {
      const disposable = await prisma.brand.create({
        data: {
          storeId: (await prisma.brand.findUnique({ where: { id: storeABrandId } }))!.storeId,
          name: 'Disposable Brand',
          slug: `disposable-brand-${runId}`,
        },
      });
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/brands/${disposable.id}`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);

      const getAfter = await request(app.getHttpServer())
        .get(`/api/v1/brands/${disposable.id}`)
        .set('Authorization', auth(adminToken));
      expect(getAfter.status).toBe(404);
    });
  });

  describe('Cross-tenant security (IDOR/BOLA)', () => {
    it('Store B cannot GET Store A category by id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/categories/${storeACategoryId}`)
        .set('Authorization', auth(storeBToken));
      expect(res.status).toBe(404);
    });

    it('Store B cannot PATCH Store A category', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${storeACategoryId}`)
        .set('Authorization', auth(storeBToken))
        .send({ name: 'Hijacked' });
      expect(res.status).toBe(404);

      const stillOriginal = await prisma.category.findUnique({ where: { id: storeACategoryId } });
      expect(stillOriginal?.name).not.toBe('Hijacked');
    });

    it('Store B cannot DELETE Store A category', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/categories/${storeACategoryId}`)
        .set('Authorization', auth(storeBToken));
      expect(res.status).toBe(404);

      const stillExists = await prisma.category.findUnique({ where: { id: storeACategoryId } });
      expect(stillExists?.deletedAt).toBeNull();
    });

    it('Store B cannot GET Store A brand by id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/brands/${storeABrandId}`)
        .set('Authorization', auth(storeBToken));
      expect(res.status).toBe(404);
    });

    it('Store B cannot PATCH Store A brand', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/brands/${storeABrandId}`)
        .set('Authorization', auth(storeBToken))
        .send({ name: 'Hijacked Brand' });
      expect(res.status).toBe(404);
    });
  });
});
