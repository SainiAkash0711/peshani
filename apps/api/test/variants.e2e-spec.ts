import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppConfig } from '../src/config/configuration';

describe('Peshani Product Variants & Generator (e2e)', () => {
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
  const customerEmail = `variant.customer.${runId}@example.com`;
  const customerPassword = 'SuperSecret123!';

  let productId: string;
  let colorAttrId: string;
  let blackId: string;
  let whiteId: string;
  let sizeAttrId: string;
  let sId: string;
  let mId: string;
  let lId: string;

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

    // Fixture: a VARIABLE product with Color (Black/White) and Size (S/M/L) -
    // created directly via Prisma since Product CRUD isn't built until Phase 2D.
    const product = await prisma.product.create({
      data: {
        storeId,
        name: `Variant Fixture Shirt ${runId}`,
        slug: `variant-fixture-shirt-${runId}`,
        basePrice: '999.00',
        costPrice: '450.00',
        productType: 'VARIABLE',
      },
    });
    productId = product.id;

    const colorAttr = await prisma.attribute.create({ data: { storeId, name: `Color ${runId}`, slug: `color-${runId}` } });
    colorAttrId = colorAttr.id;
    const black = await prisma.attributeValue.create({ data: { attributeId: colorAttrId, value: 'Black', slug: 'black' } });
    blackId = black.id;
    const white = await prisma.attributeValue.create({ data: { attributeId: colorAttrId, value: 'White', slug: 'white' } });
    whiteId = white.id;

    const sizeAttr = await prisma.attribute.create({ data: { storeId, name: `Size ${runId}`, slug: `size-${runId}` } });
    sizeAttrId = sizeAttr.id;
    const s = await prisma.attributeValue.create({ data: { attributeId: sizeAttrId, value: 'S', slug: 's' } });
    sId = s.id;
    const m = await prisma.attributeValue.create({ data: { attributeId: sizeAttrId, value: 'M', slug: 'm' } });
    mId = m.id;
    const l = await prisma.attributeValue.create({ data: { attributeId: sizeAttrId, value: 'L', slug: 'l' } });
    lId = l.id;

    // Store B: second tenant for cross-tenant tests.
    const storeB = await prisma.store.create({ data: { slug: `store-b-variant-${runId}`, name: 'Store B', isActive: true } });
    const perms = await prisma.permission.findMany({ where: { key: { in: ['product_variant.read', 'product_variant.update'] } } });
    const roleB = await prisma.role.create({ data: { storeId: storeB.id, name: 'ADMIN' } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: roleB.id, permissionId: p.id })) });
    const userB = await prisma.user.create({
      data: {
        storeId: storeB.id,
        email: `storeb.variant.${runId}@example.com`,
        passwordHash: await argon2.hash('irrelevant'),
        type: 'ADMIN',
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.userRole.create({ data: { userId: userB.id, roleId: roleB.id } });
    const storeBProduct = await prisma.product.create({
      data: { storeId: storeB.id, name: 'Store B Product', slug: `store-b-product-${runId}`, basePrice: '10.00' },
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

  describe('Variant CRUD', () => {
    let blackSVariantId: string;

    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/products/${productId}/variants`);
      expect(res.status).toBe(401);
    });

    it('rejects a plain customer', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth(customerToken));
      expect(res.status).toBe(403);
    });

    it('creates a variant', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth(adminToken))
        .send({ sku: `sku-black-s-${runId}`, price: '999.00', attributeValueIds: [blackId, sId] });
      expect(res.status).toBe(201);
      expect(res.body.sku).toBe(`SKU-BLACK-S-${runId}`.toUpperCase());
      blackSVariantId = res.body.id;
    });

    it('normalizes SKU case (case-insensitive uniqueness policy)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth(adminToken))
        .send({ sku: `sku-black-m-${runId}`.toLowerCase(), price: '999.00', attributeValueIds: [blackId, mId] });
      expect(res.status).toBe(201);
      expect(res.body.sku).toBe(res.body.sku.toUpperCase());
    });

    it('rejects a duplicate SKU (case-insensitive)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth(adminToken))
        .send({ sku: `SKU-BLACK-S-${runId}`, price: '100.00', attributeValueIds: [whiteId, sId] });
      expect(res.status).toBe(409);
    });

    it('rejects a duplicate barcode', async () => {
      const first = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth(adminToken))
        .send({ sku: `sku-white-s-${runId}`, barcode: `BC-${runId}`, price: '999.00', attributeValueIds: [whiteId, sId] });
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth(adminToken))
        .send({ sku: `sku-white-m-${runId}`, barcode: `BC-${runId}`, price: '999.00', attributeValueIds: [whiteId, mId] });
      expect(second.status).toBe(409);
    });

    it('rejects the exact same combination twice', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth(adminToken))
        .send({ sku: `sku-black-s-dup-${runId}`, price: '999.00', attributeValueIds: [blackId, sId] });
      expect(res.status).toBe(409);
    });

    it('rejects the same combination submitted in a different attribute order', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth(adminToken))
        .send({ sku: `sku-black-s-reordered-${runId}`, price: '999.00', attributeValueIds: [sId, blackId] });
      expect(res.status).toBe(409);
    });

    it('rejects a nonexistent attribute value', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth(adminToken))
        .send({ sku: `sku-invalid-${runId}`, price: '999.00', attributeValueIds: ['00000000-0000-0000-0000-000000000000'] });
      expect(res.status).toBe(404);
    });

    it('rejects an attribute value belonging to another store', async () => {
      const storeBValue = await prisma.attributeValue.create({
        data: {
          attributeId: (await prisma.attribute.create({ data: { storeId: (await prisma.product.findUnique({ where: { id: storeBProductId } }))!.storeId, name: 'X', slug: `x-${runId}` } })).id,
          value: 'X',
          slug: 'x',
        },
      });
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth(adminToken))
        .send({ sku: `sku-cross-store-${runId}`, price: '999.00', attributeValueIds: [storeBValue.id] });
      expect(res.status).toBe(404);
    });

    it('rejects a negative price', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth(adminToken))
        .send({ sku: `sku-negative-price-${runId}`, price: '-10.00', attributeValueIds: [blackId] });
      expect(res.status).toBe(400);
    });

    it('rejects a negative cost', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth(adminToken))
        .send({ sku: `sku-negative-cost-${runId}`, price: '10.00', costPrice: '-5.00', attributeValueIds: [blackId] });
      expect(res.status).toBe(400);
    });

    it('rejects a negative weight', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth(adminToken))
        .send({ sku: `sku-negative-weight-${runId}`, price: '10.00', weight: '-1.000', attributeValueIds: [blackId] });
      expect(res.status).toBe(400);
    });

    it('rejects an empty attributeValueIds array', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth(adminToken))
        .send({ sku: `sku-empty-${runId}`, price: '10.00', attributeValueIds: [] });
      expect(res.status).toBe(400);
    });

    it('updates a variant', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${productId}/variants/${blackSVariantId}`)
        .set('Authorization', auth(adminToken))
        .send({ price: '899.00' });
      expect(res.status).toBe(200);
      expect(res.body.price).toBe('899.00');
    });

    it('changes a variant\'s attribute combination and audits it distinctly from a plain update', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${productId}/variants/${blackSVariantId}`)
        .set('Authorization', auth(adminToken))
        .send({ attributeValueIds: [whiteId, mId] });
      expect(res.status).toBe(200);

      const auditEntry = await prisma.auditLog.findFirst({
        where: { entityId: blackSVariantId, action: 'VariantCombinationChanged' },
      });
      expect(auditEntry).toBeDefined();
    });

    it('changes variant status', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${productId}/variants/${blackSVariantId}/status`)
        .set('Authorization', auth(adminToken))
        .send({ status: 'INACTIVE' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('INACTIVE');
    });

    it('deletes a variant with no inventory records (soft delete)', async () => {
      const disposable = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth(adminToken))
        .send({ sku: `sku-disposable-${runId}`, price: '10.00', attributeValueIds: [whiteId, lId] });
      expect(disposable.status).toBe(201);

      const del = await request(app.getHttpServer())
        .delete(`/api/v1/products/${productId}/variants/${disposable.body.id}`)
        .set('Authorization', auth(adminToken));
      expect(del.status).toBe(200);

      const getAfter = await request(app.getHttpServer())
        .get(`/api/v1/products/${productId}/variants/${disposable.body.id}`)
        .set('Authorization', auth(adminToken));
      expect(getAfter.status).toBe(404);
    });

    it('a concurrent duplicate-SKU race leaves exactly one variant, no half-created data', async () => {
      const raceSku = `sku-race-${runId}`;
      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/products/${productId}/variants`)
          .set('Authorization', auth(adminToken))
          .send({ sku: raceSku, price: '50.00', attributeValueIds: [blackId, lId] }),
        request(app.getHttpServer())
          .post(`/api/v1/products/${productId}/variants`)
          .set('Authorization', auth(adminToken))
          .send({ sku: raceSku, price: '55.00', attributeValueIds: [whiteId, sId] }),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);

      const rows = await prisma.productVariant.findMany({ where: { storeId, sku: raceSku.toUpperCase() } });
      expect(rows.length).toBe(1);
      const joins = await prisma.productVariantAttributeValue.findMany({ where: { variantId: rows[0].id } });
      expect(joins.length).toBeGreaterThan(0);
    });
  });

  describe('Variant generator', () => {
    it('previews a 2x2 combination count', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants/preview-combinations`)
        .set('Authorization', auth(adminToken))
        .send({ axes: [{ attributeId: colorAttrId, valueIds: [blackId, whiteId] }, { attributeId: sizeAttrId, valueIds: [sId, mId] }] });
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(4);
      expect(res.body.exceedsLimit).toBe(false);
      expect(res.body.combinations).toHaveLength(4);
    });

    it('rejects (rather than silently deduping) a repeated value id within the same axis', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants/preview-combinations`)
        .set('Authorization', auth(adminToken))
        .send({ axes: [{ attributeId: colorAttrId, valueIds: [blackId, blackId, whiteId] }] });
      expect(res.status).toBe(400);
    });

    it('rejects an empty axes array', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants/preview-combinations`)
        .set('Authorization', auth(adminToken))
        .send({ axes: [] });
      expect(res.status).toBe(400);
    });

    it('reports exceedsLimit instead of erroring when over the configured maximum', async () => {
      // MAX_VARIANT_COMBINATIONS defaults to 200; 15 x 15 = 225 exceeds it.
      const manyValues = await prisma.attributeValue.createMany({
        data: Array.from({ length: 15 }, (_, i) => ({ attributeId: colorAttrId, value: `Shade ${i}`, slug: `shade-${runId}-${i}` })),
      });
      const shadeValues = await prisma.attributeValue.findMany({ where: { attributeId: colorAttrId, slug: { startsWith: `shade-${runId}-` } } });
      const manyMore = await prisma.attributeValue.createMany({
        data: Array.from({ length: 15 }, (_, i) => ({ attributeId: sizeAttrId, value: `Variant ${i}`, slug: `sizevariant-${runId}-${i}` })),
      });
      const sizeVariantValues = await prisma.attributeValue.findMany({ where: { attributeId: sizeAttrId, slug: { startsWith: `sizevariant-${runId}-` } } });
      expect(manyValues.count).toBe(15);
      expect(manyMore.count).toBe(15);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants/preview-combinations`)
        .set('Authorization', auth(adminToken))
        .send({
          axes: [
            { attributeId: colorAttrId, valueIds: shadeValues.map((v) => v.id) },
            { attributeId: sizeAttrId, valueIds: sizeVariantValues.map((v) => v.id) },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(225);
      expect(res.body.exceedsLimit).toBe(true);
      expect(res.body.combinations).toHaveLength(0);
    });

    it('generate rejects a request exceeding the configured maximum', async () => {
      const shadeValues = await prisma.attributeValue.findMany({ where: { attributeId: colorAttrId, slug: { startsWith: `shade-${runId}-` } } });
      const sizeVariantValues = await prisma.attributeValue.findMany({ where: { attributeId: sizeAttrId, slug: { startsWith: `sizevariant-${runId}-` } } });
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants/generate`)
        .set('Authorization', auth(adminToken))
        .send({
          axes: [
            { attributeId: colorAttrId, valueIds: shadeValues.map((v) => v.id) },
            { attributeId: sizeAttrId, valueIds: sizeVariantValues.map((v) => v.id) },
          ],
        });
      expect(res.status).toBe(400);
    });

    it('produces the same set of combinations regardless of axis order', async () => {
      const order1 = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants/preview-combinations`)
        .set('Authorization', auth(adminToken))
        .send({ axes: [{ attributeId: colorAttrId, valueIds: [blackId, whiteId] }, { attributeId: sizeAttrId, valueIds: [sId, mId] }] });
      const order2 = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/variants/preview-combinations`)
        .set('Authorization', auth(adminToken))
        .send({ axes: [{ attributeId: sizeAttrId, valueIds: [sId, mId] }, { attributeId: colorAttrId, valueIds: [blackId, whiteId] }] });

      const toSortedSets = (body: any) =>
        body.combinations.map((c: any) => [...c.attributeValueIds].sort().join('-')).sort();
      expect(toSortedSets(order1.body)).toEqual(toSortedSets(order2.body));
    });

    it('generates variants for a fresh product, then safely regenerates without touching existing ones', async () => {
      const freshProduct = await prisma.product.create({
        data: { storeId, name: `Generator Fixture ${runId}`, slug: `generator-fixture-${runId}`, basePrice: '500.00', productType: 'VARIABLE' },
      });

      const firstGen = await request(app.getHttpServer())
        .post(`/api/v1/products/${freshProduct.id}/variants/generate`)
        .set('Authorization', auth(adminToken))
        .send({ axes: [{ attributeId: colorAttrId, valueIds: [blackId, whiteId] }, { attributeId: sizeAttrId, valueIds: [sId, mId] }] });
      expect(firstGen.status).toBe(201);
      expect(firstGen.body.created).toHaveLength(4);
      expect(firstGen.body.preserved).toHaveLength(0);

      // Prove these are real, editable variants - not placeholders that get silently replaced.
      const editedVariantId = firstGen.body.created[0].id;
      await request(app.getHttpServer())
        .patch(`/api/v1/products/${freshProduct.id}/variants/${editedVariantId}`)
        .set('Authorization', auth(adminToken))
        .send({ price: '777.77' });

      const secondGen = await request(app.getHttpServer())
        .post(`/api/v1/products/${freshProduct.id}/variants/generate`)
        .set('Authorization', auth(adminToken))
        .send({ axes: [{ attributeId: colorAttrId, valueIds: [blackId, whiteId] }, { attributeId: sizeAttrId, valueIds: [sId, mId, lId] }] });
      expect(secondGen.status).toBe(201);
      expect(secondGen.body.preserved).toHaveLength(4);
      expect(secondGen.body.created).toHaveLength(2);
      expect(secondGen.body.totalRequested).toBe(6);

      const preservedEdited = secondGen.body.preserved.find((v: any) => v.id === editedVariantId);
      expect(preservedEdited.price).toBe('777.77');
    });

    it('rejects generation for a SIMPLE product', async () => {
      const simpleProduct = await prisma.product.create({
        data: { storeId, name: `Simple Fixture ${runId}`, slug: `simple-fixture-${runId}`, basePrice: '10.00', productType: 'SIMPLE' },
      });
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${simpleProduct.id}/variants/generate`)
        .set('Authorization', auth(adminToken))
        .send({ axes: [{ attributeId: colorAttrId, valueIds: [blackId] }] });
      expect(res.status).toBe(400);
    });
  });

  describe('Cross-tenant security (IDOR/BOLA)', () => {
    it('Store B cannot list Store A product variants', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth(storeBToken));
      expect(res.status).toBe(404);
    });

    it("Store B cannot PATCH one of Store A's variants via Store B's own product path", async () => {
      const variants = await prisma.productVariant.findMany({ where: { productId }, take: 1 });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${storeBProductId}/variants/${variants[0].id}`)
        .set('Authorization', auth(storeBToken))
        .send({ price: '1.00' });
      expect(res.status).toBe(404);
    });
  });
});
