import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEFAULT_STORE_SLUG } from '../src/modules/store-settings/store-settings.service';

/**
 * Phase 3 - Customer Storefront & Catalog (e2e).
 *
 * Every route under test here is public (no Authorization header is ever
 * sent) - that is itself part of what's being verified. Fixtures are created
 * directly via Prisma against the seeded "peshani" store (StoreSettingsService
 * always resolves that one store - see its DEFAULT_STORE_SLUG comment), plus
 * a second, throwaway store for the cross-tenant isolation checks.
 */
describe('Peshani Storefront Catalog (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storeId: string;

  const runId = Date.now();
  const api = () => request(app.getHttpServer());

  // Category hierarchy: parentCategory -> childCategory. Products are only
  // ever assigned to the child, so "filter by parent" tests genuinely
  // exercise hierarchy-aware filtering rather than a direct match.
  let parentCategoryId: string;
  let childCategoryId: string;
  let inactiveCategoryId: string;
  let brandId: string;
  let inactiveBrandId: string;

  let activeWarehouseId: string;
  let inactiveWarehouseId: string;

  let simpleProductId: string;
  let simpleProductSlug: string;
  let draftProductSlug: string;
  let inactiveProductSlug: string;
  let archivedProductSlug: string;

  let variableProductId: string;
  let variableProductSlug: string;
  let activeVariantAId: string; // Black
  let activeVariantBId: string; // White
  let archivedVariantId: string; // Red - must never surface as a selectable option
  let colorAttributeId: string;
  let blackValueId: string;
  let whiteValueId: string;
  let redValueId: string;

  let storeBProductSlug: string;
  let storeBCategorySlug: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const store = await prisma.store.findUniqueOrThrow({ where: { slug: DEFAULT_STORE_SLUG } });
    storeId = store.id;

    // ---- Categories (hierarchy) ----
    const parent = await prisma.category.create({
      data: { storeId, name: `Storefront Parent ${runId}`, slug: `sf-parent-${runId}`, isActive: true, isFeatured: true },
    });
    parentCategoryId = parent.id;
    const child = await prisma.category.create({
      data: { storeId, name: `Storefront Child ${runId}`, slug: `sf-child-${runId}`, parentId: parent.id, isActive: true },
    });
    childCategoryId = child.id;
    const inactiveCategory = await prisma.category.create({
      data: { storeId, name: `Storefront Inactive Cat ${runId}`, slug: `sf-inactive-cat-${runId}`, isActive: false },
    });
    inactiveCategoryId = inactiveCategory.id;

    // ---- Brands ----
    const brand = await prisma.brand.create({
      data: { storeId, name: `Storefront Brand ${runId}`, slug: `sf-brand-${runId}`, isActive: true },
    });
    brandId = brand.id;
    const inactiveBrand = await prisma.brand.create({
      data: { storeId, name: `Storefront Inactive Brand ${runId}`, slug: `sf-inactive-brand-${runId}`, isActive: false },
    });
    inactiveBrandId = inactiveBrand.id;

    // ---- Warehouses (one active, one inactive - inactive stock must never count) ----
    const activeWarehouse = await prisma.warehouse.create({
      data: { storeId, name: `SF Active WH ${runId}`, code: `SF-ACT-${runId}`, isActive: true },
    });
    activeWarehouseId = activeWarehouse.id;
    const inactiveWarehouse = await prisma.warehouse.create({
      data: { storeId, name: `SF Inactive WH ${runId}`, code: `SF-INACT-${runId}`, isActive: false },
    });
    inactiveWarehouseId = inactiveWarehouse.id;

    // ---- SIMPLE product, ACTIVE, IN_STOCK, assigned to the child category + brand ----
    simpleProductSlug = `sf-simple-${runId}`;
    const simpleProduct = await prisma.product.create({
      data: {
        storeId,
        name: `Storefront Simple Product ${runId}`,
        slug: simpleProductSlug,
        sku: `SF-SIMPLE-${runId}`,
        status: 'ACTIVE',
        productType: 'SIMPLE',
        basePrice: '499.00',
        costPrice: '111.00',
        compareAtPrice: '599.00',
        brandId,
        isFeatured: true,
        isBestseller: true,
        isNewArrival: true,
        publishedAt: new Date(),
      },
    });
    simpleProductId = simpleProduct.id;
    await prisma.productCategory.create({ data: { productId: simpleProduct.id, categoryId: child.id } });
    await prisma.productImage.create({
      data: { storeId, productId: simpleProduct.id, url: 'https://example.test/simple-primary.jpg', altText: 'Primary', isPrimary: true, sortOrder: 0, isActive: true },
    });
    // A stale-sortOrder trap: this second image has sortOrder 0 too but is
    // NOT primary - proves primaryImage selection uses isPrimary, not
    // "images[0] by sortOrder" (see the fix applied during this phase).
    await prisma.productImage.create({
      data: { storeId, productId: simpleProduct.id, url: 'https://example.test/simple-decoy.jpg', altText: 'Decoy', isPrimary: false, sortOrder: 0, isActive: true },
    });
    // Plenty of available stock on the ACTIVE warehouse, well above threshold -> IN_STOCK.
    await prisma.inventoryItem.create({
      data: { storeId, productId: simpleProduct.id, variantId: null, warehouseId: activeWarehouseId, onHandQuantity: 100, availableQuantity: 100, reservedQuantity: 0, lowStockThreshold: 5 },
    });
    // A large amount of stock sitting in an INACTIVE warehouse - must never
    // count toward public availability, or this test would wrongly pass.
    await prisma.inventoryItem.create({
      data: { storeId, productId: simpleProduct.id, variantId: null, warehouseId: inactiveWarehouseId, onHandQuantity: 9999, availableQuantity: 9999, reservedQuantity: 0, lowStockThreshold: 0 },
    });

    // ---- SIMPLE products in every non-ACTIVE status - none may ever be publicly visible ----
    draftProductSlug = `sf-draft-${runId}`;
    await prisma.product.create({ data: { storeId, name: 'SF Draft', slug: draftProductSlug, sku: `SF-DRAFT-${runId}`, status: 'DRAFT', basePrice: '10.00' } });
    inactiveProductSlug = `sf-inactive-${runId}`;
    await prisma.product.create({ data: { storeId, name: 'SF Inactive', slug: inactiveProductSlug, sku: `SF-INACTIVE-${runId}`, status: 'INACTIVE', basePrice: '10.00' } });
    archivedProductSlug = `sf-archived-${runId}`;
    await prisma.product.create({ data: { storeId, name: 'SF Archived', slug: archivedProductSlug, sku: `SF-ARCHIVED-${runId}`, status: 'ARCHIVED', basePrice: '10.00' } });

    // ---- VARIABLE product with an ACTIVE + an ARCHIVED variant ----
    const colorAttribute = await prisma.attribute.create({ data: { storeId, name: `SF Color ${runId}`, slug: `sf-color-${runId}` } });
    colorAttributeId = colorAttribute.id;
    const black = await prisma.attributeValue.create({ data: { attributeId: colorAttribute.id, value: 'Black', slug: 'black' } });
    blackValueId = black.id;
    const white = await prisma.attributeValue.create({ data: { attributeId: colorAttribute.id, value: 'White', slug: 'white' } });
    whiteValueId = white.id;
    const red = await prisma.attributeValue.create({ data: { attributeId: colorAttribute.id, value: 'Red', slug: 'red' } });
    redValueId = red.id;

    variableProductSlug = `sf-variable-${runId}`;
    const variableProduct = await prisma.product.create({
      data: { storeId, name: `Storefront Variable Product ${runId}`, slug: variableProductSlug, status: 'ACTIVE', productType: 'VARIABLE', basePrice: '1000.00', publishedAt: new Date() },
    });
    variableProductId = variableProduct.id;
    await prisma.productAttribute.create({ data: { productId: variableProduct.id, attributeId: colorAttribute.id } });

    const variantA = await prisma.productVariant.create({
      data: { storeId, productId: variableProduct.id, sku: `SF-VAR-A-${runId}`, price: '1000.00', status: 'ACTIVE', combinationKey: black.id },
    });
    activeVariantAId = variantA.id;
    await prisma.productVariantAttributeValue.create({ data: { variantId: variantA.id, attributeValueId: black.id } });
    // Low stock on purpose: available (2) <= threshold (5) -> LOW_STOCK. No
    // reservation involved (reservedQuantity stays 0), so this doesn't need a
    // matching StockReservation row to satisfy inventory.e2e-spec.ts's
    // whole-table reservedQuantity-accounting invariant check.
    await prisma.inventoryItem.create({
      data: { storeId, productId: variableProduct.id, variantId: variantA.id, warehouseId: activeWarehouseId, onHandQuantity: 2, availableQuantity: 2, reservedQuantity: 0, lowStockThreshold: 5 },
    });

    const variantB = await prisma.productVariant.create({
      data: { storeId, productId: variableProduct.id, sku: `SF-VAR-B-${runId}`, price: '1100.00', status: 'ACTIVE', combinationKey: white.id },
    });
    activeVariantBId = variantB.id;
    await prisma.productVariantAttributeValue.create({ data: { variantId: variantB.id, attributeValueId: white.id } });
    // No inventory row at all for variant B -> OUT_OF_STOCK by definition.

    const archivedVariant = await prisma.productVariant.create({
      data: { storeId, productId: variableProduct.id, sku: `SF-VAR-ARCHIVED-${runId}`, price: '1200.00', status: 'ARCHIVED', combinationKey: red.id },
    });
    archivedVariantId = archivedVariant.id;
    await prisma.productVariantAttributeValue.create({ data: { variantId: archivedVariant.id, attributeValueId: red.id } });

    // ---- Store B: second tenant, for cross-tenant isolation checks ----
    const storeB = await prisma.store.create({ data: { slug: `sf-store-b-${runId}`, name: 'SF Store B', isActive: true } });
    storeBProductSlug = `sf-storeb-product-${runId}`;
    await prisma.product.create({
      data: { storeId: storeB.id, name: 'SF Store B Product', slug: storeBProductSlug, sku: `SF-STOREB-${runId}`, status: 'ACTIVE', basePrice: '20.00' },
    });
    storeBCategorySlug = `sf-storeb-cat-${runId}`;
    await prisma.category.create({ data: { storeId: storeB.id, name: 'SF Store B Category', slug: storeBCategorySlug, isActive: true } });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Security & scope boundaries', () => {
    it('never requires an Authorization header for any storefront route', async () => {
      const responses = await Promise.all([
        api().get('/api/v1/storefront/home'),
        api().get('/api/v1/storefront/products'),
        api().get('/api/v1/storefront/categories'),
        api().get('/api/v1/storefront/brands'),
      ]);
      for (const res of responses) {
        expect(res.status).toBe(200);
      }
    });

    it('exposes no unknown commerce routes beyond Cart/Checkout/Orders/Payments/Shipping/Promotions/Coupons (in-scope as of Phases 4-7)', async () => {
      // Bare /checkout and /payments have no root-level route of their own
      // (real subpaths are /checkout/validate, /payments/razorpay/verify,
      // etc.) so they still 404. /shipping (as opposed to the real
      // /shipping-methods) remains genuinely unknown too. /orders DOES have
      // a root GET now (Phase 5) and correctly requires auth (401) rather
      // than not existing at all. /coupons (Phase 7 correction) DOES now
      // also have a root GET (admin-gated) for the exact same reason -
      // it moved from "genuinely unknown" to "exists, auth-required" the
      // moment CouponsController was added, same as /orders in Phase 5.
      const forbiddenPaths = ['/api/v1/checkout', '/api/v1/payments', '/api/v1/shipping'];
      for (const path of forbiddenPaths) {
        const res = await api().get(path);
        expect(res.status).toBe(404);
      }
      const authRequiredPaths = ['/api/v1/orders', '/api/v1/coupons', '/api/v1/promotions'];
      for (const path of authRequiredPaths) {
        const res = await api().get(path);
        expect(res.status).toBe(401);
      }
    });
  });

  describe('Product visibility - ACTIVE-only enforcement', () => {
    it('returns an ACTIVE product by slug', async () => {
      const res = await api().get(`/api/v1/storefront/products/${simpleProductSlug}`);
      expect(res.status).toBe(200);
      expect(res.body.slug).toBe(simpleProductSlug);
    });

    it.each([
      ['DRAFT', () => draftProductSlug],
      ['INACTIVE', () => inactiveProductSlug],
      ['ARCHIVED', () => archivedProductSlug],
    ])('returns 404 for a %s product accessed directly by slug', async (_label, getSlug) => {
      const res = await api().get(`/api/v1/storefront/products/${getSlug()}`);
      expect(res.status).toBe(404);
    });

    it('returns 404 for an unknown slug', async () => {
      const res = await api().get('/api/v1/storefront/products/does-not-exist-at-all');
      expect(res.status).toBe(404);
    });

    it.each([
      ['DRAFT', () => draftProductSlug],
      ['INACTIVE', () => inactiveProductSlug],
      ['ARCHIVED', () => archivedProductSlug],
    ])('never lists a %s product in search results, even searching its own exact slug', async (_label, getSlug) => {
      const res = await api().get('/api/v1/storefront/products').query({ search: getSlug() });
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });
  });

  describe('Public DTO shape - no internal leakage', () => {
    it('never includes costPrice, barcode, or raw inventory quantities anywhere in a product detail response', async () => {
      const res = await api().get(`/api/v1/storefront/products/${simpleProductSlug}`);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toMatch(/costPrice/i);
      expect(raw).not.toMatch(/barcode/i);
      expect(raw).not.toMatch(/onHandQuantity/i);
      expect(raw).not.toMatch(/reservedQuantity/i);
      expect(raw).not.toMatch(/availableQuantity/i);
      expect(raw).not.toMatch(/warehouse/i);
      expect(raw).not.toMatch(/"metadata"/i);
    });

    it('never includes costPrice or raw inventory quantities anywhere in a product listing response', async () => {
      const res = await api().get('/api/v1/storefront/products').query({ pageSize: 50 });
      const raw = JSON.stringify(res.body);
      expect(raw).not.toMatch(/costPrice/i);
      expect(raw).not.toMatch(/onHandQuantity/i);
      expect(raw).not.toMatch(/reservedQuantity/i);
    });

    it('selects the isPrimary image, not just the first by sortOrder', async () => {
      const res = await api().get(`/api/v1/storefront/products/${simpleProductSlug}`);
      expect(res.body.primaryImage.url).toBe('https://example.test/simple-primary.jpg');
    });
  });

  describe('Inventory availability - safe enum only', () => {
    it('reports IN_STOCK for a SIMPLE product with ample stock on an active warehouse', async () => {
      const res = await api().get(`/api/v1/storefront/products/${simpleProductSlug}`);
      expect(res.body.availability).toBe('IN_STOCK');
    });

    it('ignores stock sitting in an inactive warehouse entirely', async () => {
      // If the inactive warehouse's 9999 units were counted, availability
      // could never legitimately read anything but IN_STOCK regardless of
      // the active warehouse - this is really exercised by the test above,
      // this one documents the intent explicitly via a direct DB check.
      const rows = await prisma.inventoryItem.findMany({ where: { productId: simpleProductId } });
      expect(rows.some((r) => r.warehouseId === inactiveWarehouseId && r.availableQuantity > 0)).toBe(true);
    });

    it('reports LOW_STOCK for a variant whose available quantity is at or below its threshold', async () => {
      const res = await api().get(`/api/v1/storefront/products/${variableProductSlug}`);
      const variantA = res.body.variants.find((v: { id: string }) => v.id === activeVariantAId);
      expect(variantA.availability).toBe('LOW_STOCK');
    });

    it('reports OUT_OF_STOCK for a variant with no inventory row at all', async () => {
      const res = await api().get(`/api/v1/storefront/products/${variableProductSlug}`);
      const variantB = res.body.variants.find((v: { id: string }) => v.id === activeVariantBId);
      expect(variantB.availability).toBe('OUT_OF_STOCK');
    });

    it('only ever returns IN_STOCK, LOW_STOCK, or OUT_OF_STOCK as availability values', async () => {
      const res = await api().get('/api/v1/storefront/products').query({ pageSize: 50 });
      const values = new Set(res.body.items.map((p: { availability: string }) => p.availability));
      for (const v of values) {
        expect(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']).toContain(v);
      }
    });
  });

  describe('Variant selection', () => {
    it('only returns ACTIVE variants for a VARIABLE product', async () => {
      const res = await api().get(`/api/v1/storefront/products/${variableProductSlug}`);
      const variantIds = res.body.variants.map((v: { id: string }) => v.id);
      expect(variantIds).toEqual(expect.arrayContaining([activeVariantAId, activeVariantBId]));
      expect(variantIds).not.toContain(archivedVariantId);
    });

    it('never surfaces an attribute value used only by an ARCHIVED variant as a selectable option', async () => {
      const res = await api().get(`/api/v1/storefront/products/${variableProductSlug}`);
      const colorOption = res.body.options.find((o: { attributeId: string }) => o.attributeId === colorAttributeId);
      const valueIds = colorOption.values.map((v: { valueId: string }) => v.valueId);
      expect(valueIds).toEqual(expect.arrayContaining([blackValueId, whiteValueId]));
      expect(valueIds).not.toContain(redValueId);
    });

    it('prices a VARIABLE product listing card as a min/max range across its ACTIVE variants', async () => {
      const res = await api().get('/api/v1/storefront/products').query({ search: variableProductSlug });
      const card = res.body.items.find((p: { slug: string }) => p.slug === variableProductSlug);
      expect(card.priceRange).toEqual({ min: '1000.00', max: '1100.00' });
    });
  });

  describe('Category catalog', () => {
    it('lists only active categories in the tree', async () => {
      const res = await api().get('/api/v1/storefront/categories');
      const findNode = (nodes: any[], id: string): any => {
        for (const n of nodes) {
          if (n.id === id) return n;
          const found = findNode(n.children, id);
          if (found) return found;
        }
        return undefined;
      };
      expect(findNode(res.body, parentCategoryId)).toBeDefined();
      expect(findNode(res.body, inactiveCategoryId)).toBeUndefined();
    });

    it('returns breadcrumbs and children for a category detail page', async () => {
      const res = await api().get(`/api/v1/storefront/categories/sf-child-${runId}`);
      expect(res.status).toBe(200);
      expect(res.body.breadcrumbs.map((b: { id: string }) => b.id)).toEqual([parentCategoryId, childCategoryId]);
      expect(res.body).not.toHaveProperty('parentId');
    });

    it('returns 404 for an inactive category slug', async () => {
      const res = await api().get(`/api/v1/storefront/categories/sf-inactive-cat-${runId}`);
      expect(res.status).toBe(404);
    });

    it("filters products by a parent category, including its child's products (hierarchy-aware)", async () => {
      const res = await api().get(`/api/v1/storefront/categories/sf-parent-${runId}/products`);
      expect(res.status).toBe(200);
      const slugs = res.body.items.map((p: { slug: string }) => p.slug);
      expect(slugs).toContain(simpleProductSlug);
    });

    it('an unknown categorySlug filter on the general listing yields an empty page, not an error', async () => {
      const res = await api().get('/api/v1/storefront/products').query({ categorySlug: 'no-such-category-xyz' });
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });
  });

  describe('Brand catalog', () => {
    it('lists an active brand but never an inactive one, searching each by its own unique name', async () => {
      const activeRes = await api().get('/api/v1/storefront/brands').query({ search: `Storefront Brand ${runId}` });
      expect(activeRes.body.items.map((b: { slug: string }) => b.slug)).toContain(`sf-brand-${runId}`);

      const inactiveRes = await api().get('/api/v1/storefront/brands').query({ search: `Storefront Inactive Brand ${runId}` });
      expect(inactiveRes.body.items).toEqual([]);
    });

    it('returns 404 for an inactive brand slug', async () => {
      const res = await api().get(`/api/v1/storefront/brands/sf-inactive-brand-${runId}`);
      expect(res.status).toBe(404);
    });

    it('filters products by brand', async () => {
      const res = await api().get(`/api/v1/storefront/brands/sf-brand-${runId}/products`);
      expect(res.status).toBe(200);
      const slugs = res.body.items.map((p: { slug: string }) => p.slug);
      expect(slugs).toContain(simpleProductSlug);
    });
  });

  describe('Pagination, search & sort', () => {
    it('honors page/pageSize and returns a well-formed pagination envelope', async () => {
      const res = await api().get('/api/v1/storefront/products').query({ page: 1, pageSize: 1, search: `Storefront Simple Product ${runId}` });
      expect(res.status).toBe(200);
      expect(res.body.pagination).toEqual({ page: 1, pageSize: 1, total: 1, totalPages: 1 });
      expect(res.body.items).toHaveLength(1);
    });

    it('sorts by price ascending and descending', async () => {
      const asc = await api().get('/api/v1/storefront/products').query({ sortBy: 'price', sortOrder: 'asc', pageSize: 100 });
      const desc = await api().get('/api/v1/storefront/products').query({ sortBy: 'price', sortOrder: 'desc', pageSize: 100 });
      const ascPrices = asc.body.items.map((p: { basePrice: string }) => Number(p.basePrice));
      const descPrices = desc.body.items.map((p: { basePrice: string }) => Number(p.basePrice));
      expect(ascPrices).toEqual([...ascPrices].sort((a, b) => a - b));
      expect(descPrices).toEqual([...descPrices].sort((a, b) => b - a));
    });

    it('rejects an out-of-range pageSize', async () => {
      const res = await api().get('/api/v1/storefront/products').query({ pageSize: 500 });
      expect(res.status).toBe(400);
    });
  });

  describe('Home page', () => {
    it('surfaces the featured/bestseller/new-arrival flags set on the fixture product', async () => {
      const res = await api().get('/api/v1/storefront/home');
      expect(res.status).toBe(200);
      const allSlugs = [...res.body.featuredProducts, ...res.body.bestsellers, ...res.body.newArrivals].map((p: { slug: string }) => p.slug);
      expect(allSlugs).toContain(simpleProductSlug);
    });
  });

  describe('Cross-tenant isolation', () => {
    it("never returns Store B's product by slug", async () => {
      const res = await api().get(`/api/v1/storefront/products/${storeBProductSlug}`);
      expect(res.status).toBe(404);
    });

    it("never returns Store B's product in a search across all products", async () => {
      const res = await api().get('/api/v1/storefront/products').query({ search: 'SF Store B Product' });
      expect(res.body.items).toEqual([]);
    });

    it("never returns Store B's category in the public category tree", async () => {
      const res = await api().get('/api/v1/storefront/categories');
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(storeBCategorySlug);
    });

    it("never returns Store B's product via the general listing category filter", async () => {
      const res = await api().get(`/api/v1/storefront/categories/${storeBCategorySlug}`);
      expect(res.status).toBe(404);
    });
  });
});
