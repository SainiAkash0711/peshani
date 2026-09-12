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

describe('Peshani Products (e2e)', () => {
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
  const customerEmail = `product.customer.${runId}@example.com`;
  const customerPassword = 'SuperSecret123!';

  let categoryId: string;
  let brandId: string;
  let colorAttrId: string;
  let blackId: string;
  let whiteId: string;
  let sizeAttrId: string;
  let sId: string;
  let mId: string;
  let lId: string;

  let storeBCategoryId: string;
  let storeBProductId: string;

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

    const category = await prisma.category.create({ data: { storeId, name: `Product Cat ${runId}`, slug: `product-cat-${runId}` } });
    categoryId = category.id;
    const brand = await prisma.brand.create({ data: { storeId, name: `Product Brand ${runId}`, slug: `product-brand-${runId}` } });
    brandId = brand.id;

    const colorAttr = await prisma.attribute.create({ data: { storeId, name: `PColor ${runId}`, slug: `pcolor-${runId}` } });
    colorAttrId = colorAttr.id;
    blackId = (await prisma.attributeValue.create({ data: { attributeId: colorAttrId, value: 'Black', slug: 'black' } })).id;
    whiteId = (await prisma.attributeValue.create({ data: { attributeId: colorAttrId, value: 'White', slug: 'white' } })).id;

    const sizeAttr = await prisma.attribute.create({ data: { storeId, name: `PSize ${runId}`, slug: `psize-${runId}` } });
    sizeAttrId = sizeAttr.id;
    sId = (await prisma.attributeValue.create({ data: { attributeId: sizeAttrId, value: 'S', slug: 's' } })).id;
    mId = (await prisma.attributeValue.create({ data: { attributeId: sizeAttrId, value: 'M', slug: 'm' } })).id;
    lId = (await prisma.attributeValue.create({ data: { attributeId: sizeAttrId, value: 'L', slug: 'l' } })).id;

    // Store B: second tenant for cross-tenant tests.
    const storeB = await prisma.store.create({ data: { slug: `store-b-product-${runId}`, name: 'Store B', isActive: true } });
    const perms = await prisma.permission.findMany({
      where: {
        key: {
          in: [
            'product.read',
            'product.update',
            'product.create',
            'product.status',
            'product_variant.read',
            'product_variant.update',
          ],
        },
      },
    });
    const roleB = await prisma.role.create({ data: { storeId: storeB.id, name: 'ADMIN' } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: roleB.id, permissionId: p.id })) });
    const userB = await prisma.user.create({
      data: {
        storeId: storeB.id,
        email: `storeb.product.${runId}@example.com`,
        passwordHash: await argon2.hash('irrelevant'),
        type: 'ADMIN',
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.userRole.create({ data: { userId: userB.id, roleId: roleB.id } });
    const storeBCategory = await prisma.category.create({ data: { storeId: storeB.id, name: 'Store B Category', slug: `store-b-cat-${runId}` } });
    storeBCategoryId = storeBCategory.id;
    const storeBProduct = await prisma.product.create({
      data: { storeId: storeB.id, name: 'Store B Product', slug: `store-b-product-${runId}`, basePrice: '10.00', sku: `STOREB-${runId}` },
    });
    storeBProductId = storeBProduct.id;

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

  describe('Product CRUD', () => {
    let simpleProductId: string;
    let variableProductId: string;

    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/products');
      expect(res.status).toBe(401);
    });

    it('rejects a plain customer', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/products').set('Authorization', auth(customerToken));
      expect(res.status).toBe(403);
    });

    it('rejects creating a simple product without a SKU', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', auth(adminToken))
        .send({ name: `No Sku ${runId}`, basePrice: '100.00' });
      expect(res.status).toBe(400);
    });

    it('creates a simple product', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', auth(adminToken))
        .send({ name: `Coffee Mug ${runId}`, sku: `mug-${runId}`, basePrice: '499.00' });
      expect(res.status).toBe(201);
      expect(res.body.productType).toBe('SIMPLE');
      expect(res.body.sku).toBe(`MUG-${runId}`.toUpperCase());
      expect(res.body.status).toBe('DRAFT');
      simpleProductId = res.body.id;
    });

    it('rejects a variable product created with a top-level SKU', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', auth(adminToken))
        .send({ name: `Bad Variable ${runId}`, productType: 'VARIABLE', sku: 'SHOULD-NOT-BE-ALLOWED', basePrice: '100.00' });
      expect(res.status).toBe(400);
    });

    it('creates a variable product with category, brand, tags and attributes', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', auth(adminToken))
        .send({
          name: `Classic T-Shirt ${runId}`,
          productType: 'VARIABLE',
          basePrice: '999.00',
          brandId,
          categoryIds: [categoryId],
          tagNames: ['summer', 'trending'],
          attributeIds: [colorAttrId, sizeAttrId],
        });
      expect(res.status).toBe(201);
      expect(res.body.sku).toBeNull();
      expect(res.body.brand.id).toBe(brandId);
      expect(res.body.categories.map((c: any) => c.id)).toContain(categoryId);
      expect(res.body.tags.map((t: any) => t.name)).toEqual(expect.arrayContaining(['summer', 'trending']));
      expect(res.body.attributes.map((a: any) => a.id)).toEqual(expect.arrayContaining([colorAttrId, sizeAttrId]));
      variableProductId = res.body.id;
    });

    it('gets a product by id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${simpleProductId}`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(simpleProductId);
    });

    it('updates a product', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${simpleProductId}`)
        .set('Authorization', auth(adminToken))
        .send({ shortDescription: 'A fine mug' });
      expect(res.status).toBe(200);
      expect(res.body.shortDescription).toBe('A fine mug');
    });

    it('auto-suffixes the slug on a name collision', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', auth(adminToken))
        .send({ name: `Coffee Mug ${runId}`, sku: `mug2-${runId}`, basePrice: '399.00' });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe(`${slugify(`Coffee Mug ${runId}`)}-2`);
    });

    it('rejects an explicitly supplied slug that already exists', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', auth(adminToken))
        .send({ name: 'Something Else', slug: slugify(`Coffee Mug ${runId}`), sku: `mug3-${runId}`, basePrice: '1.00' });
      expect(res.status).toBe(409);
    });

    it('changing brand/categories/tags/attributes on update audits each distinctly', async () => {
      // Uses its own fixture product (not variableProductId) so later tests that
      // rely on variableProductId's original brand/category assignments are unaffected.
      const created = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', auth(adminToken))
        .send({ name: `Audit Fixture ${runId}`, sku: `auditfixture-${runId}`, basePrice: '1.00', brandId, categoryIds: [categoryId] });
      const auditProductId = created.body.id;

      const secondCategory = await prisma.category.create({ data: { storeId, name: `Second Cat ${runId}`, slug: `second-cat-${runId}` } });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${auditProductId}`)
        .set('Authorization', auth(adminToken))
        .send({ brandId: null, categoryIds: [secondCategory.id], tagNames: ['clearance'], attributeIds: [colorAttrId] });
      expect(res.status).toBe(200);
      expect(res.body.brand).toBeNull();
      expect(res.body.categories.map((c: any) => c.id)).toEqual([secondCategory.id]);

      const events = ['ProductBrandChanged', 'ProductCategoriesChanged', 'ProductTagsChanged', 'ProductAttributesChanged'];
      for (const action of events) {
        const entry = await prisma.auditLog.findFirst({ where: { entityId: auditProductId, action } });
        expect(entry).toBeDefined();
      }
    });

    it('rejects a duplicate SKU', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', auth(adminToken))
        .send({ name: `Dup Sku Product ${runId}`, sku: `mug-${runId}`, basePrice: '1.00' });
      expect(res.status).toBe(409);
    });

    it('rejects an invalid category id', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', auth(adminToken))
        .send({ name: `Bad Category ${runId}`, sku: `badcat-${runId}`, basePrice: '1.00', categoryIds: ['00000000-0000-0000-0000-000000000000'] });
      expect(res.status).toBe(404);
    });

    it('rejects an invalid brand id', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', auth(adminToken))
        .send({ name: `Bad Brand ${runId}`, sku: `badbrand-${runId}`, basePrice: '1.00', brandId: '00000000-0000-0000-0000-000000000000' });
      expect(res.status).toBe(404);
    });

    it('rejects an invalid attribute id', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', auth(adminToken))
        .send({ name: `Bad Attr ${runId}`, sku: `badattr-${runId}`, basePrice: '1.00', attributeIds: ['00000000-0000-0000-0000-000000000000'] });
      expect(res.status).toBe(404);
    });

    it('rejects a category belonging to another store', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', auth(adminToken))
        .send({ name: `Cross Store Cat ${runId}`, sku: `crosscat-${runId}`, basePrice: '1.00', categoryIds: [storeBCategoryId] });
      expect(res.status).toBe(404);
    });

    it('lists products with pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/products?page=1&pageSize=2')
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      expect(res.body.pagination).toEqual(expect.objectContaining({ page: 1, pageSize: 2 }));
    });

    it('searches by name and by SKU', async () => {
      const byName = await request(app.getHttpServer())
        .get(`/api/v1/products?search=${encodeURIComponent(`Coffee Mug ${runId}`)}`)
        .set('Authorization', auth(adminToken));
      expect(byName.body.items.length).toBeGreaterThan(0);

      const bySku = await request(app.getHttpServer())
        .get(`/api/v1/products?search=MUG-${runId}`)
        .set('Authorization', auth(adminToken));
      expect(bySku.body.items.some((p: any) => p.id === simpleProductId)).toBe(true);
    });

    it('filters by type, status, brandId and categoryId', async () => {
      const byType = await request(app.getHttpServer())
        .get('/api/v1/products?type=VARIABLE')
        .set('Authorization', auth(adminToken));
      expect(byType.body.items.every((p: any) => p.productType === 'VARIABLE')).toBe(true);

      const byBrand = await request(app.getHttpServer())
        .get(`/api/v1/products?brandId=${brandId}`)
        .set('Authorization', auth(adminToken));
      expect(byBrand.body.items.some((p: any) => p.id === variableProductId)).toBe(true);

      const byCategory = await request(app.getHttpServer())
        .get(`/api/v1/products?categoryId=${categoryId}`)
        .set('Authorization', auth(adminToken));
      expect(byCategory.body.items.some((p: any) => p.id === variableProductId)).toBe(true);
    });

    it('sorts by name ascending', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/products?sortBy=name&sortOrder=asc&pageSize=100')
        .set('Authorization', auth(adminToken));
      const names = res.body.items.map((p: any) => p.name);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sorted);
    });

    it('cannot activate a variable product with no variants', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${variableProductId}/status`)
        .set('Authorization', auth(adminToken))
        .send({ status: 'ACTIVE' });
      expect(res.status).toBe(409);
    });

    it('activates a simple product with a SKU', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${simpleProductId}/status`)
        .set('Authorization', auth(adminToken))
        .send({ status: 'ACTIVE' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.publishedAt).not.toBeNull();
    });

    it('rejects an invalid status transition', async () => {
      const archived = await request(app.getHttpServer())
        .patch(`/api/v1/products/${simpleProductId}/status`)
        .set('Authorization', auth(adminToken))
        .send({ status: 'ARCHIVED' });
      expect(archived.status).toBe(200);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${simpleProductId}/status`)
        .set('Authorization', auth(adminToken))
        .send({ status: 'ACTIVE' });
      expect(res.status).toBe(409);
    });

    it('deletes a product with no dependencies', async () => {
      const disposable = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', auth(adminToken))
        .send({ name: `Disposable Product ${runId}`, sku: `disposable-${runId}`, basePrice: '1.00' });
      expect(disposable.status).toBe(201);

      const del = await request(app.getHttpServer())
        .delete(`/api/v1/products/${disposable.body.id}`)
        .set('Authorization', auth(adminToken));
      expect(del.status).toBe(200);

      const getAfter = await request(app.getHttpServer())
        .get(`/api/v1/products/${disposable.body.id}`)
        .set('Authorization', auth(adminToken));
      expect(getAfter.status).toBe(404);
    });

    it('duplicates a product without copying SKU, forcing DRAFT status', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${variableProductId}/duplicate`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(201);
      expect(res.body.sku).toBeNull();
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.name).toContain('Copy');
      expect(res.body.categories.map((c: any) => c.id)).toContain(categoryId);
      expect(res.body.brand.id).toBe(brandId);
    });

    it('a concurrent duplicate-SKU race leaves exactly one product', async () => {
      const raceSku = `race-sku-${runId}`;
      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/products')
          .set('Authorization', auth(adminToken))
          .send({ name: `Race A ${runId}`, sku: raceSku, basePrice: '10.00' }),
        request(app.getHttpServer())
          .post('/api/v1/products')
          .set('Authorization', auth(adminToken))
          .send({ name: `Race B ${runId}`, sku: raceSku, basePrice: '20.00' }),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);

      const rows = await prisma.product.findMany({ where: { storeId, sku: raceSku.toUpperCase() } });
      expect(rows.length).toBe(1);
    });

    it('a failed relationship update leaves the product categories unchanged (no partial write)', async () => {
      const before = await request(app.getHttpServer())
        .get(`/api/v1/products/${variableProductId}`)
        .set('Authorization', auth(adminToken));
      const beforeCategoryIds = before.body.categories.map((c: any) => c.id).sort();

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${variableProductId}`)
        .set('Authorization', auth(adminToken))
        .send({ categoryIds: [categoryId, '00000000-0000-0000-0000-000000000000'] });
      expect(res.status).toBe(404);

      const after = await request(app.getHttpServer())
        .get(`/api/v1/products/${variableProductId}`)
        .set('Authorization', auth(adminToken));
      expect(after.body.categories.map((c: any) => c.id).sort()).toEqual(beforeCategoryIds);
    });
  });

  describe('Variable product + variant integration (reusing Phase 2C)', () => {
    let integrationProductId: string;

    it('creates a variable product and generates variants through the existing 2C endpoints', async () => {
      const product = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', auth(adminToken))
        .send({ name: `Integration Shirt ${runId}`, productType: 'VARIABLE', basePrice: '799.00', attributeIds: [colorAttrId, sizeAttrId] });
      expect(product.status).toBe(201);
      integrationProductId = product.body.id;

      const generate = await request(app.getHttpServer())
        .post(`/api/v1/products/${integrationProductId}/variants/generate`)
        .set('Authorization', auth(adminToken))
        .send({ axes: [{ attributeId: colorAttrId, valueIds: [blackId, whiteId] }, { attributeId: sizeAttrId, valueIds: [sId, mId] }] });
      expect(generate.status).toBe(201);
      expect(generate.body.created).toHaveLength(4);

      const detail = await request(app.getHttpServer())
        .get(`/api/v1/products/${integrationProductId}`)
        .set('Authorization', auth(adminToken));
      expect(detail.body.variantCount).toBe(4);
    });

    it('activates once variants exist', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${integrationProductId}/status`)
        .set('Authorization', auth(adminToken))
        .send({ status: 'ACTIVE' });
      expect(res.status).toBe(200);
    });

    it('regenerates safely: preserves existing variants, only creates the new combination', async () => {
      const variantsBefore = await request(app.getHttpServer())
        .get(`/api/v1/products/${integrationProductId}/variants?pageSize=50`)
        .set('Authorization', auth(adminToken));
      const editedVariantId = variantsBefore.body.items[0].id;
      await request(app.getHttpServer())
        .patch(`/api/v1/products/${integrationProductId}/variants/${editedVariantId}`)
        .set('Authorization', auth(adminToken))
        .send({ price: '850.00' });

      const regenerate = await request(app.getHttpServer())
        .post(`/api/v1/products/${integrationProductId}/variants/generate`)
        .set('Authorization', auth(adminToken))
        .send({ axes: [{ attributeId: colorAttrId, valueIds: [blackId, whiteId] }, { attributeId: sizeAttrId, valueIds: [sId, mId, lId] }] });
      expect(regenerate.status).toBe(201);
      expect(regenerate.body.preserved).toHaveLength(4);
      expect(regenerate.body.created).toHaveLength(2);

      const preservedEdited = regenerate.body.preserved.find((v: any) => v.id === editedVariantId);
      expect(preservedEdited.price).toBe('850.00');

      const detail = await request(app.getHttpServer())
        .get(`/api/v1/products/${integrationProductId}`)
        .set('Authorization', auth(adminToken));
      expect(detail.body.variantCount).toBe(6);
    });
  });

  describe('Cross-tenant security (IDOR/BOLA)', () => {
    let storeAProductId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', auth(adminToken))
        .send({ name: `Security Fixture ${runId}`, sku: `secfix-${runId}`, basePrice: '10.00' });
      storeAProductId = res.body.id;
    });

    it('Store B cannot GET Store A product', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${storeAProductId}`)
        .set('Authorization', auth(storeBToken));
      expect(res.status).toBe(404);
    });

    it('Store B cannot PATCH Store A product', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${storeAProductId}`)
        .set('Authorization', auth(storeBToken))
        .send({ name: 'Hijacked' });
      expect(res.status).toBe(404);

      const stillOriginal = await prisma.product.findUnique({ where: { id: storeAProductId } });
      expect(stillOriginal?.name).not.toBe('Hijacked');
    });

    it('Store B cannot change Store A product status', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${storeAProductId}/status`)
        .set('Authorization', auth(storeBToken))
        .send({ status: 'ACTIVE' });
      expect(res.status).toBe(404);
    });

    it("Store B's role has no delete permission at all, so it can't even attempt to delete (403 before the store-scope check runs)", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/products/${storeAProductId}`)
        .set('Authorization', auth(storeBToken));
      expect(res.status).toBe(403);

      const stillExists = await prisma.product.findUnique({ where: { id: storeAProductId } });
      expect(stillExists?.deletedAt).toBeNull();
    });

    it("Store B cannot assign Store A's category/brand/attribute to its own product", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${storeBProductId}`)
        .set('Authorization', auth(storeBToken))
        .send({ categoryIds: [categoryId] });
      expect(res.status).toBe(404);

      const res2 = await request(app.getHttpServer())
        .patch(`/api/v1/products/${storeBProductId}`)
        .set('Authorization', auth(storeBToken))
        .send({ brandId });
      expect(res2.status).toBe(404);

      const res3 = await request(app.getHttpServer())
        .patch(`/api/v1/products/${storeBProductId}`)
        .set('Authorization', auth(storeBToken))
        .send({ attributeIds: [colorAttrId] });
      expect(res3.status).toBe(404);
    });

    it("Store B cannot modify Store A's variant via Store A's product path", async () => {
      const variant = await prisma.productVariant.findFirst({ where: { productId: storeAProductId } });
      if (!variant) return;
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${storeAProductId}/variants/${variant.id}`)
        .set('Authorization', auth(storeBToken))
        .send({ price: '1.00' });
      expect(res.status).toBe(404);
    });
  });
});
