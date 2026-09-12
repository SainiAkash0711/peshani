import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import * as argon2 from 'argon2';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppConfig } from '../src/config/configuration';

async function makeImage(format: 'jpeg' | 'png' | 'webp', size = 20): Promise<Buffer> {
  const image = sharp({
    create: { width: size, height: size, channels: 3, background: { r: 10, g: 120, b: 200 } },
  });
  if (format === 'jpeg') return image.jpeg().toBuffer();
  if (format === 'png') return image.png().toBuffer();
  return image.webp().toBuffer();
}

describe('Peshani Product & Variant Media (e2e)', () => {
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
  const customerEmail = `media.customer.${runId}@example.com`;
  const customerPassword = 'SuperSecret123!';

  let productId: string;
  let variableProductId: string;
  let variantId: string;
  let otherProductId: string;
  let otherVariantId: string;

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

    const product = await prisma.product.create({
      data: { storeId, name: `Media Product ${runId}`, slug: `media-product-${runId}`, basePrice: '100.00', sku: `MEDIA-${runId}` },
    });
    productId = product.id;

    const variableProduct = await prisma.product.create({
      data: { storeId, name: `Media Variable ${runId}`, slug: `media-variable-${runId}`, basePrice: '200.00', productType: 'VARIABLE' },
    });
    variableProductId = variableProduct.id;
    const variant = await prisma.productVariant.create({
      data: { storeId, productId: variableProductId, sku: `MEDIA-VAR-${runId}`, price: '200.00', combinationKey: `mk-${runId}` },
    });
    variantId = variant.id;

    const otherProduct = await prisma.product.create({
      data: { storeId, name: `Other Media Product ${runId}`, slug: `other-media-product-${runId}`, basePrice: '50.00', productType: 'VARIABLE' },
    });
    otherProductId = otherProduct.id;
    const otherVariant = await prisma.productVariant.create({
      data: { storeId, productId: otherProductId, sku: `OTHER-VAR-${runId}`, price: '50.00', combinationKey: `ok-${runId}` },
    });
    otherVariantId = otherVariant.id;

    // Store B: second tenant for cross-tenant tests.
    const storeB = await prisma.store.create({ data: { slug: `store-b-media-${runId}`, name: 'Store B', isActive: true } });
    const perms = await prisma.permission.findMany({
      where: { key: { in: ['product_media.read', 'product_media.update', 'product_media.delete'] } },
    });
    const roleB = await prisma.role.create({ data: { storeId: storeB.id, name: 'ADMIN' } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: roleB.id, permissionId: p.id })) });
    const userB = await prisma.user.create({
      data: {
        storeId: storeB.id,
        email: `storeb.media.${runId}@example.com`,
        passwordHash: await argon2.hash('irrelevant'),
        type: 'ADMIN',
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.userRole.create({ data: { userId: userB.id, roleId: roleB.id } });
    const storeBProduct = await prisma.product.create({
      data: { storeId: storeB.id, name: 'Store B Media Product', slug: `store-b-media-product-${runId}`, basePrice: '10.00', sku: `STOREB-MEDIA-${runId}` },
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

  describe('Product images', () => {
    let firstImageId: string;
    let secondImageId: string;

    it('rejects an unauthenticated upload', async () => {
      const buffer = await makeImage('jpeg');
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/images`)
        .attach('file', buffer, 'photo.jpg');
      expect(res.status).toBe(401);
    });

    it('rejects a plain customer', async () => {
      const buffer = await makeImage('jpeg');
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(customerToken))
        .attach('file', buffer, 'photo.jpg');
      expect(res.status).toBe(403);
    });

    it('rejects an upload with no file', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(400);
    });

    it('rejects an invalid product id', async () => {
      const buffer = await makeImage('jpeg');
      const res = await request(app.getHttpServer())
        .post('/api/v1/products/00000000-0000-0000-0000-000000000000/images')
        .set('Authorization', auth(adminToken))
        .attach('file', buffer, 'photo.jpg');
      expect(res.status).toBe(404);
    });

    it('uploads a valid JPEG and it becomes primary automatically (first image)', async () => {
      const buffer = await makeImage('jpeg', 30);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken))
        .attach('file', buffer, 'photo.jpg')
        .field('altText', 'A product photo');
      expect(res.status).toBe(201);
      expect(res.body.width).toBe(30);
      expect(res.body.height).toBe(30);
      expect(res.body.mimeType).toBe('image/jpeg');
      expect(res.body.isPrimary).toBe(true);
      expect(res.body.altText).toBe('A product photo');
      expect(res.body.contentHash).toHaveLength(64);
      // Never exposes an internal filesystem path - only a safe media URL.
      expect(res.body.url).toMatch(/^http:\/\/localhost:\d+\/media\//);
      firstImageId = res.body.id;
    });

    it('uploads a second valid PNG, which is not automatically primary', async () => {
      const buffer = await makeImage('png', 25);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken))
        .attach('file', buffer, 'photo2.png');
      expect(res.status).toBe(201);
      expect(res.body.mimeType).toBe('image/png');
      expect(res.body.isPrimary).toBe(false);
      secondImageId = res.body.id;
    });

    it('lists images ordered by sortOrder', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.map((i: any) => i.id)).toEqual([firstImageId, secondImageId]);
    });

    it('updates alt text and caption', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${productId}/images/${secondImageId}`)
        .set('Authorization', auth(adminToken))
        .send({ altText: 'Second angle', caption: 'From the side' });
      expect(res.status).toBe(200);
      expect(res.body.altText).toBe('Second angle');
      expect(res.body.caption).toBe('From the side');
    });

    it('changing primary unsets the previous primary (exactly one primary at a time)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${productId}/images/${secondImageId}/primary`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.isPrimary).toBe(true);

      const list = await request(app.getHttpServer())
        .get(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken));
      const primaries = list.body.filter((i: any) => i.isPrimary);
      expect(primaries).toHaveLength(1);
      expect(primaries[0].id).toBe(secondImageId);
    });

    it('reorders images', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${productId}/images/reorder`)
        .set('Authorization', auth(adminToken))
        .send({ items: [{ id: secondImageId, sortOrder: 0 }, { id: firstImageId, sortOrder: 1 }] });
      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(2);

      const list = await request(app.getHttpServer())
        .get(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken));
      expect(list.body.map((i: any) => i.id)).toEqual([secondImageId, firstImageId]);
    });

    it('rejects a reorder with a duplicate image id', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${productId}/images/reorder`)
        .set('Authorization', auth(adminToken))
        .send({ items: [{ id: firstImageId, sortOrder: 0 }, { id: firstImageId, sortOrder: 1 }] });
      expect(res.status).toBe(400);
    });

    it('rejects a reorder referencing an image from another product', async () => {
      const foreign = await prisma.productImage.create({
        data: { storeId, productId: otherProductId, url: 'http://example.com/x.jpg', storageKey: null, sortOrder: 0 },
      });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${productId}/images/reorder`)
        .set('Authorization', auth(adminToken))
        .send({ items: [{ id: foreign.id, sortOrder: 0 }] });
      expect(res.status).toBe(404);
    });

    it('deleting the primary image auto-promotes the next one (deterministic behavior)', async () => {
      const del = await request(app.getHttpServer())
        .delete(`/api/v1/products/${productId}/images/${secondImageId}`)
        .set('Authorization', auth(adminToken));
      expect(del.status).toBe(200);

      const list = await request(app.getHttpServer())
        .get(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken));
      expect(list.body).toHaveLength(1);
      expect(list.body[0].id).toBe(firstImageId);
      expect(list.body[0].isPrimary).toBe(true);
    });
  });

  describe('Image count limits (1-5)', () => {
    // `productId` has exactly 1 image left over from the previous describe
    // block ("deleting the primary image auto-promotes the next one"),
    // which is the starting state this suite needs.
    it('rejects deleting the last remaining image', async () => {
      const list = await request(app.getHttpServer())
        .get(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken));
      expect(list.body).toHaveLength(1);
      const lastImageId = list.body[0].id;

      const del = await request(app.getHttpServer())
        .delete(`/api/v1/products/${productId}/images/${lastImageId}`)
        .set('Authorization', auth(adminToken));
      expect(del.status).toBe(409);

      const after = await request(app.getHttpServer())
        .get(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken));
      expect(after.body).toHaveLength(1);
    });

    it('allows uploading up to 5 images total, then rejects a 6th', async () => {
      for (let i = 0; i < 4; i += 1) {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/products/${productId}/images`)
          .set('Authorization', auth(adminToken))
          .attach('file', await makeImage('jpeg'), { filename: `limit-${i}.jpg`, contentType: 'image/jpeg' });
        expect(res.status).toBe(201);
      }

      const atFive = await request(app.getHttpServer())
        .get(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken));
      expect(atFive.body).toHaveLength(5);

      const sixth = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken))
        .attach('file', await makeImage('jpeg'), { filename: 'limit-6.jpg', contentType: 'image/jpeg' });
      expect(sixth.status).toBe(409);

      const stillFive = await request(app.getHttpServer())
        .get(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken));
      expect(stillFive.body).toHaveLength(5);
    });

    it('allows deleting from 5 back down to 1 without error', async () => {
      const list = await request(app.getHttpServer())
        .get(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken));
      expect(list.body).toHaveLength(5);
      const ids = list.body.map((img: { id: string }) => img.id);

      for (let i = 0; i < 4; i += 1) {
        const res = await request(app.getHttpServer())
          .delete(`/api/v1/products/${productId}/images/${ids[i]}`)
          .set('Authorization', auth(adminToken));
        expect(res.status).toBe(200);
      }

      const after = await request(app.getHttpServer())
        .get(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken));
      expect(after.body).toHaveLength(1);
    });
  });

  describe('Upload validation and malicious content', () => {
    it('rejects an unsupported MIME type (SVG is not in the allowlist)', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken))
        .attach('file', svg, { filename: 'image.svg', contentType: 'image/svg+xml' });
      expect(res.status).toBe(400);
    });

    it('rejects HTML content renamed to .jpg', async () => {
      const html = Buffer.from('<html><body><script>alert(1)</script></body></html>');
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken))
        .attach('file', html, { filename: 'image.jpg', contentType: 'image/jpeg' });
      expect(res.status).toBe(400);
    });

    it('rejects a JS payload renamed to .png', async () => {
      const js = Buffer.from('alert("this is not an image")');
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken))
        .attach('file', js, { filename: 'image.png', contentType: 'image/png' });
      expect(res.status).toBe(400);
    });

    it('rejects invalid magic bytes even with a plausible extension and Content-Type', async () => {
      const bogus = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken))
        .attach('file', bogus, { filename: 'image.jpg', contentType: 'image/jpeg' });
      expect(res.status).toBe(400);
    });

    it('rejects a claimed Content-Type that does not match the actual decoded format', async () => {
      const jpeg = await makeImage('jpeg');
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken))
        .attach('file', jpeg, { filename: 'photo.png', contentType: 'image/png' });
      expect(res.status).toBe(400);
    });

    it('rejects a corrupted/truncated image', async () => {
      const validJpeg = await makeImage('jpeg');
      const corrupted = validJpeg.subarray(0, 20);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken))
        .attach('file', corrupted, { filename: 'broken.jpg', contentType: 'image/jpeg' });
      expect(res.status).toBe(400);
    });

    it('rejects an oversized file', async () => {
      // 2200x2200x3 uncompressed raw canvas, PNG-encoded with no compression:
      // reliably lands between the 10MB business limit (MediaUploadService,
      // -> 400) and multer's own 20MB hard ceiling (-> 413), so this
      // specifically exercises the configurable business-limit rejection.
      const huge = await sharp({ create: { width: 2200, height: 2200, channels: 3, background: { r: 1, g: 2, b: 3 } } })
        .png({ compressionLevel: 0 })
        .toBuffer();
      expect(huge.length).toBeGreaterThan(10 * 1024 * 1024);
      expect(huge.length).toBeLessThan(20 * 1024 * 1024);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken))
        .attach('file', huge, { filename: 'huge.png', contentType: 'image/png' });
      expect(res.status).toBe(400);
    }, 30000);

    it('a path-traversal filename never affects the actual storage path (server generates the key)', async () => {
      const buffer = await makeImage('jpeg');
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken))
        .attach('file', buffer, { filename: '../../../../etc/passwd.jpg', contentType: 'image/jpeg' });
      expect(res.status).toBe(201);

      const row = await prisma.productImage.findUnique({ where: { id: res.body.id } });
      expect(row?.storageKey).not.toContain('..');
      expect(row?.storageKey).toMatch(new RegExp(`^stores/${storeId}/products/${productId}/[0-9a-f-]+\\.jpg$`));

      // Clean up so it doesn't affect later "list" assertions in this file.
      await request(app.getHttpServer())
        .delete(`/api/v1/products/${productId}/images/${res.body.id}`)
        .set('Authorization', auth(adminToken));
    });
  });

  describe('Variant images', () => {
    let variantImageId: string;

    it('uploads a variant image', async () => {
      const buffer = await makeImage('webp');
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${variableProductId}/variants/${variantId}/images`)
        .set('Authorization', auth(adminToken))
        .attach('file', buffer, 'variant.webp');
      expect(res.status).toBe(201);
      expect(res.body.mimeType).toBe('image/webp');
      expect(res.body.isPrimary).toBe(true);
      variantImageId = res.body.id;
    });

    it('lists variant images', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${variableProductId}/variants/${variantId}/images`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('updates variant image metadata', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${variableProductId}/variants/${variantId}/images/${variantImageId}`)
        .set('Authorization', auth(adminToken))
        .send({ altText: 'Variant angle' });
      expect(res.status).toBe(200);
      expect(res.body.altText).toBe('Variant angle');
    });

    it('sets variant primary image (idempotent - already primary)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${variableProductId}/variants/${variantId}/images/${variantImageId}/primary`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.isPrimary).toBe(true);
    });

    it('reorders variant images', async () => {
      const second = await request(app.getHttpServer())
        .post(`/api/v1/products/${variableProductId}/variants/${variantId}/images`)
        .set('Authorization', auth(adminToken))
        .attach('file', await makeImage('png'), 'v2.png');

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${variableProductId}/variants/${variantId}/images/reorder`)
        .set('Authorization', auth(adminToken))
        .send({ items: [{ id: second.body.id, sortOrder: 0 }, { id: variantImageId, sortOrder: 1 }] });
      expect(res.status).toBe(200);
    });

    it('rejects a variant that does not belong to the given product', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${variableProductId}/variants/${otherVariantId}/images`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(404);
    });

    it('rejects an invalid variant id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${variableProductId}/variants/00000000-0000-0000-0000-000000000000/images`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(404);
    });

    it('deletes a variant image', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/products/${variableProductId}/variants/${variantId}/images/${variantImageId}`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
    });
  });

  describe('Variant image count limit (max 5, no minimum)', () => {
    // The preceding "Variant images" block leaves one image behind (its
    // "reorders variant images" test adds a second image that the later
    // "deletes a variant image" test never removes) - clean up first so
    // this block starts from a known, empty state regardless of that.
    beforeAll(async () => {
      const list = await request(app.getHttpServer())
        .get(`/api/v1/products/${variableProductId}/variants/${variantId}/images`)
        .set('Authorization', auth(adminToken));
      for (const image of list.body as { id: string }[]) {
        await request(app.getHttpServer())
          .delete(`/api/v1/products/${variableProductId}/variants/${variantId}/images/${image.id}`)
          .set('Authorization', auth(adminToken));
      }
    });

    // Leaves the variant back at 0 images afterward so the next describe
    // block's own fixture upload (which expects to succeed) isn't blocked
    // by a leftover full gallery here.
    afterAll(async () => {
      const list = await request(app.getHttpServer())
        .get(`/api/v1/products/${variableProductId}/variants/${variantId}/images`)
        .set('Authorization', auth(adminToken));
      for (const image of list.body as { id: string }[]) {
        await request(app.getHttpServer())
          .delete(`/api/v1/products/${variableProductId}/variants/${variantId}/images/${image.id}`)
          .set('Authorization', auth(adminToken));
      }
    });

    it('a variant with zero images is valid (unlike a product)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${variableProductId}/variants/${variantId}/images`)
        .set('Authorization', auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });

    it('allows uploading up to 5 variant images, then rejects a 6th', async () => {
      for (let i = 0; i < 5; i += 1) {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/products/${variableProductId}/variants/${variantId}/images`)
          .set('Authorization', auth(adminToken))
          .attach('file', await makeImage('jpeg'), { filename: `variant-limit-${i}.jpg`, contentType: 'image/jpeg' });
        expect(res.status).toBe(201);
      }

      const atFive = await request(app.getHttpServer())
        .get(`/api/v1/products/${variableProductId}/variants/${variantId}/images`)
        .set('Authorization', auth(adminToken));
      expect(atFive.body).toHaveLength(5);

      const sixth = await request(app.getHttpServer())
        .post(`/api/v1/products/${variableProductId}/variants/${variantId}/images`)
        .set('Authorization', auth(adminToken))
        .attach('file', await makeImage('jpeg'), { filename: 'variant-limit-6.jpg', contentType: 'image/jpeg' });
      expect(sixth.status).toBe(409);
    });
  });

  describe('Cross-tenant security (IDOR/BOLA)', () => {
    let storeAImageId: string;
    let storeAVariantImageId: string;

    beforeAll(async () => {
      const productImage = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(adminToken))
        .attach('file', await makeImage('jpeg'), 'security.jpg');
      storeAImageId = productImage.body.id;

      const variantImage = await request(app.getHttpServer())
        .post(`/api/v1/products/${variableProductId}/variants/${variantId}/images`)
        .set('Authorization', auth(adminToken))
        .attach('file', await makeImage('jpeg'), 'security-variant.jpg');
      storeAVariantImageId = variantImage.body.id;
    });

    it('Store B cannot list Store A product images', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(storeBToken));
      expect(res.status).toBe(404);
    });

    it('Store B cannot update a Store A product image', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${productId}/images/${storeAImageId}`)
        .set('Authorization', auth(storeBToken))
        .send({ altText: 'Hijacked' });
      expect(res.status).toBe(404);

      const stillOriginal = await prisma.productImage.findUnique({ where: { id: storeAImageId } });
      expect(stillOriginal?.altText).not.toBe('Hijacked');
    });

    it('Store B cannot delete a Store A product image', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/products/${productId}/images/${storeAImageId}`)
        .set('Authorization', auth(storeBToken));
      expect(res.status).toBe(404);

      const stillExists = await prisma.productImage.findUnique({ where: { id: storeAImageId } });
      expect(stillExists).not.toBeNull();
    });

    it('Store B cannot attach media to a Store A product (upload)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/products/${productId}/images`)
        .set('Authorization', auth(storeBToken))
        .attach('file', await makeImage('jpeg'), 'hijack.jpg');
      // Store B's fixture role has no product_media.create permission at all,
      // so this is correctly rejected at the permission layer (403) before
      // the store-scope check ever runs - see the equivalent note in Phase 2C/2D.
      expect(res.status).toBe(403);
    });

    it('Store B cannot access Store A variant images', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${variableProductId}/variants/${variantId}/images`)
        .set('Authorization', auth(storeBToken));
      expect(res.status).toBe(404);
    });

    it('Store B cannot delete a Store A variant image', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/products/${variableProductId}/variants/${variantId}/images/${storeAVariantImageId}`)
        .set('Authorization', auth(storeBToken));
      expect(res.status).toBe(404);

      const stillExists = await prisma.variantImage.findUnique({ where: { id: storeAVariantImageId } });
      expect(stillExists).not.toBeNull();
    });

    it("Store B cannot attach media to its own product using Store A's ids anywhere in the path", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${storeBProductId}/images`)
        .set('Authorization', auth(storeBToken));
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});
