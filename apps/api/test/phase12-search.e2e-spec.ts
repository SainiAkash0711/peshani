import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEFAULT_STORE_SLUG } from '../src/modules/store-settings/store-settings.service';

/**
 * Phase 12 - Search & SEO-support endpoints (e2e).
 *
 * The relevance-ranking tests all search for a single, runId-embedded term
 * that cannot possibly appear in any of this long-lived shared dev
 * database's accumulated history from prior phases (e.g. `zzsearch<runId>`)
 * - this sidesteps the "top-N ranking is unreliable once a shared database
 * has thousands of unrelated rows" problem documented in the Phase 11
 * report, by construction rather than by post-hoc verification.
 */
describe('Peshani Phase 12 - Search & SEO support (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storeId: string;

  const runId = Date.now();
  const api = () => request(app.getHttpServer());
  const term = `zzsearch${runId}`;

  let filterCategorySlug: string;
  let filterBrandSlug: string;
  let availabilityCategorySlug: string;
  let sortCategorySlug: string;
  let activeWarehouseId: string;

  let redValueId: string;
  let sizeMValueId: string;
  let sizeLValueId: string;
  let attributeProductSlug: string;

  let storeBProductSlug: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const store = await prisma.store.findUniqueOrThrow({ where: { slug: DEFAULT_STORE_SLUG } });
    storeId = store.id;

    const warehouse = await prisma.warehouse.create({
      data: { storeId, name: `P12 WH ${runId}`, code: `P12-WH-${runId}`, isActive: true },
    });
    activeWarehouseId = warehouse.id;

    // ---------------------------------------------------------------------
    // Relevance tiers - each fixture is engineered to match exactly ONE tier
    // and nothing else, and no fixture's OTHER fields (name/sku/description/
    // brand/category) ever contain `term` unless that field IS the tier
    // being tested.
    // ---------------------------------------------------------------------
    const unrelatedBrand = await prisma.brand.create({ data: { storeId, name: `P12 Unrelated Brand ${runId}`, slug: `p12-unrelated-brand-${runId}`, isActive: true } });
    const unrelatedCategory = await prisma.category.create({ data: { storeId, name: `P12 Unrelated Cat ${runId}`, slug: `p12-unrelated-cat-${runId}`, isActive: true } });

    await mkProduct('exact', { name: `ZZSearch${runId}` }); // exact (case-insensitive)
    await mkProduct('prefix', { name: `${term}Extra` });
    await mkProduct('contains', { name: `Cool ${term} Item` });
    // Real product/variant SKUs are always uppercase-normalized by
    // ProductsService/ProductVariantsService before being persisted - these
    // fixtures bypass that service layer (direct Prisma), so they must
    // mirror that same normalization themselves to reflect real data.
    await mkProduct('skuExact', { name: 'Unrelated Name One', sku: term.toUpperCase() });
    const variantSkuProduct = await mkProduct('variantSkuHost', { name: 'Unrelated Name Two', productType: 'VARIABLE' });
    await prisma.productVariant.create({ data: { storeId, productId: variantSkuProduct.id, sku: term.toUpperCase(), price: '10.00', status: 'ACTIVE', combinationKey: `p12-vsk-${runId}` } });
    const brandForTerm = await prisma.brand.create({ data: { storeId, name: `Brand ${term}`, slug: `p12-brand-term-${runId}`, isActive: true } });
    await mkProduct('brand', { name: 'Unrelated Name Three', brandId: brandForTerm.id });
    const categoryForTerm = await prisma.category.create({ data: { storeId, name: `Category ${term}`, slug: `p12-cat-term-${runId}`, isActive: true } });
    const catProduct = await mkProduct('category', { name: 'Unrelated Name Four' });
    await prisma.productCategory.create({ data: { productId: catProduct.id, categoryId: categoryForTerm.id } });
    await mkProduct('shortDesc', { name: 'Unrelated Name Five', shortDescription: `mentions ${term} in short desc` });
    await mkProduct('description', { name: 'Unrelated Name Six', description: `mentions ${term} in the long description` });

    // Tie-break fixtures: two "contains" tier matches, different createdAt.
    await prisma.product.create({
      data: { storeId, name: `Older Contains ${term} Match`, slug: `p12-tie-old-${runId}`, sku: `P12-TIE-OLD-${runId}`, status: 'ACTIVE', basePrice: '10.00', createdAt: new Date(Date.now() - 60_000) },
    });
    await prisma.product.create({
      data: { storeId, name: `Newer Contains ${term} Match`, slug: `p12-tie-new-${runId}`, sku: `P12-TIE-NEW-${runId}`, status: 'ACTIVE', basePrice: '10.00', createdAt: new Date() },
    });

    // ---------------------------------------------------------------------
    // Escaping fixtures - a literal `_`/`%` in the query must never behave
    // as a SQL wildcard.
    // ---------------------------------------------------------------------
    await prisma.product.create({
      data: { storeId, name: `abcQdef${runId}`, slug: `p12-esc-underscore-decoy-${runId}`, sku: `P12-ESCU-${runId}`, status: 'ACTIVE', basePrice: '10.00' },
    });
    await prisma.product.create({
      data: { storeId, name: `50OffSaleDecoy${runId}`, slug: `p12-esc-percent-decoy-${runId}`, sku: `P12-ESCP-${runId}`, status: 'ACTIVE', basePrice: '10.00' },
    });
    await prisma.product.create({
      data: { storeId, name: `50%OffSale${runId}`, slug: `p12-esc-percent-real-${runId}`, sku: `P12-ESCPR-${runId}`, status: 'ACTIVE', basePrice: '10.00' },
    });

    // ---------------------------------------------------------------------
    // Filters: price (variant-aware), availability, attributes - each in
    // its own dedicated category so result counts are fully controlled
    // regardless of the shared database's accumulated history.
    // ---------------------------------------------------------------------
    const filterCategory = await prisma.category.create({ data: { storeId, name: `P12 Filter Cat ${runId}`, slug: `p12-filter-cat-${runId}`, isActive: true } });
    filterCategorySlug = filterCategory.slug;
    const filterBrand = await prisma.brand.create({ data: { storeId, name: `P12 Filter Brand ${runId}`, slug: `p12-filter-brand-${runId}`, isActive: true } });
    filterBrandSlug = filterBrand.slug;

    const cheapSimple = await prisma.product.create({
      data: { storeId, name: `P12 Cheap Simple ${runId}`, slug: `p12-cheap-simple-${runId}`, sku: `P12-CHEAP-${runId}`, status: 'ACTIVE', basePrice: '100.00', brandId: filterBrand.id },
    });
    await prisma.productCategory.create({ data: { productId: cheapSimple.id, categoryId: filterCategory.id } });

    const pricedVariable = await prisma.product.create({
      data: { storeId, name: `P12 Priced Variable ${runId}`, slug: `p12-priced-variable-${runId}`, status: 'ACTIVE', productType: 'VARIABLE', basePrice: '999.00' },
    });
    await prisma.productCategory.create({ data: { productId: pricedVariable.id, categoryId: filterCategory.id } });
    await prisma.productVariant.create({ data: { storeId, productId: pricedVariable.id, sku: `P12-PV-LOW-${runId}`, price: '50.00', status: 'ACTIVE', combinationKey: `p12-pv-low-${runId}` } });
    await prisma.productVariant.create({ data: { storeId, productId: pricedVariable.id, sku: `P12-PV-HIGH-${runId}`, price: '150.00', status: 'ACTIVE', combinationKey: `p12-pv-high-${runId}` } });

    // ---- Availability ----
    const availabilityCategory = await prisma.category.create({ data: { storeId, name: `P12 Availability Cat ${runId}`, slug: `p12-avail-cat-${runId}`, isActive: true } });
    availabilityCategorySlug = availabilityCategory.slug;

    const inStockProduct = await prisma.product.create({ data: { storeId, name: `P12 InStock ${runId}`, slug: `p12-instock-${runId}`, sku: `P12-INSTOCK-${runId}`, status: 'ACTIVE', basePrice: '20.00' } });
    await prisma.productCategory.create({ data: { productId: inStockProduct.id, categoryId: availabilityCategory.id } });
    await prisma.inventoryItem.create({ data: { storeId, productId: inStockProduct.id, variantId: null, warehouseId: activeWarehouseId, onHandQuantity: 50, availableQuantity: 50, reservedQuantity: 0, lowStockThreshold: 5 } });

    const lowStockProduct = await prisma.product.create({ data: { storeId, name: `P12 LowStock ${runId}`, slug: `p12-lowstock-${runId}`, sku: `P12-LOWSTOCK-${runId}`, status: 'ACTIVE', basePrice: '20.00' } });
    await prisma.productCategory.create({ data: { productId: lowStockProduct.id, categoryId: availabilityCategory.id } });
    await prisma.inventoryItem.create({ data: { storeId, productId: lowStockProduct.id, variantId: null, warehouseId: activeWarehouseId, onHandQuantity: 2, availableQuantity: 2, reservedQuantity: 0, lowStockThreshold: 5 } });

    const outOfStockProduct = await prisma.product.create({ data: { storeId, name: `P12 OutOfStock ${runId}`, slug: `p12-outofstock-${runId}`, sku: `P12-OUTOFSTOCK-${runId}`, status: 'ACTIVE', basePrice: '20.00' } });
    await prisma.productCategory.create({ data: { productId: outOfStockProduct.id, categoryId: availabilityCategory.id } });
    // No inventory row at all -> OUT_OF_STOCK by definition.

    // ---- Attribute filter (must match on a SINGLE variant) ----
    const colorAttribute = await prisma.attribute.create({ data: { storeId, name: `P12 Color ${runId}`, slug: `p12-color-${runId}` } });
    const red = await prisma.attributeValue.create({ data: { attributeId: colorAttribute.id, value: 'Red', slug: `p12-red-${runId}` } });
    redValueId = red.id;
    const blue = await prisma.attributeValue.create({ data: { attributeId: colorAttribute.id, value: 'Blue', slug: `p12-blue-${runId}` } });
    const sizeAttribute = await prisma.attribute.create({ data: { storeId, name: `P12 Size ${runId}`, slug: `p12-size-${runId}` } });
    const sizeM = await prisma.attributeValue.create({ data: { attributeId: sizeAttribute.id, value: 'M', slug: `p12-m-${runId}` } });
    sizeMValueId = sizeM.id;
    const sizeL = await prisma.attributeValue.create({ data: { attributeId: sizeAttribute.id, value: 'L', slug: `p12-l-${runId}` } });
    sizeLValueId = sizeL.id;

    attributeProductSlug = `p12-attr-product-${runId}`;
    const attributeProduct = await prisma.product.create({
      data: { storeId, name: `P12 Attribute Product ${runId}`, slug: attributeProductSlug, status: 'ACTIVE', productType: 'VARIABLE', basePrice: '80.00' },
    });
    const redMVariant = await prisma.productVariant.create({ data: { storeId, productId: attributeProduct.id, sku: `P12-ATTR-REDM-${runId}`, price: '80.00', status: 'ACTIVE', combinationKey: `p12-redm-${runId}` } });
    await prisma.productVariantAttributeValue.create({ data: { variantId: redMVariant.id, attributeValueId: red.id } });
    await prisma.productVariantAttributeValue.create({ data: { variantId: redMVariant.id, attributeValueId: sizeM.id } });
    const blueLVariant = await prisma.productVariant.create({ data: { storeId, productId: attributeProduct.id, sku: `P12-ATTR-BLUEL-${runId}`, price: '85.00', status: 'ACTIVE', combinationKey: `p12-bluel-${runId}` } });
    await prisma.productVariantAttributeValue.create({ data: { variantId: blueLVariant.id, attributeValueId: blue.id } });
    await prisma.productVariantAttributeValue.create({ data: { variantId: blueLVariant.id, attributeValueId: sizeL.id } });

    // ---- Sorting: dedicated category, distinct name/price/createdAt ----
    const sortCategory = await prisma.category.create({ data: { storeId, name: `P12 Sort Cat ${runId}`, slug: `p12-sort-cat-${runId}`, isActive: true } });
    sortCategorySlug = sortCategory.slug;
    const sortFixtures = [
      { name: `Alpha Sort ${runId}`, price: '300.00', ageMs: 3000 },
      { name: `Bravo Sort ${runId}`, price: '100.00', ageMs: 2000 },
      { name: `Charlie Sort ${runId}`, price: '200.00', ageMs: 1000 },
    ];
    for (const f of sortFixtures) {
      const p = await prisma.product.create({
        data: { storeId, name: f.name, slug: `p12-sort-${f.name.toLowerCase().replace(/\s+/g, '-')}`, sku: `P12-SORT-${f.name}`, status: 'ACTIVE', basePrice: f.price, createdAt: new Date(Date.now() - f.ageMs) },
      });
      await prisma.productCategory.create({ data: { productId: p.id, categoryId: sortCategory.id } });
    }

    // ---- Cross-tenant ----
    const storeB = await prisma.store.create({ data: { slug: `p12-store-b-${runId}`, name: 'P12 Store B', isActive: true } });
    storeBProductSlug = `p12-storeb-${runId}`;
    await prisma.product.create({ data: { storeId: storeB.id, name: `ZZSearch${runId} Store B Product`, slug: storeBProductSlug, sku: `P12-STOREB-${runId}`, status: 'ACTIVE', basePrice: '20.00' } });

    async function mkProduct(key: string, overrides: Partial<{ name: string; sku: string; shortDescription: string; description: string; brandId: string; productType: 'SIMPLE' | 'VARIABLE' }>) {
      return prisma.product.create({
        data: {
          storeId,
          name: overrides.name ?? `P12 ${key} ${runId}`,
          slug: `p12-${key}-${runId}`,
          sku: overrides.sku ?? `P12-${key.toUpperCase()}-${runId}`,
          shortDescription: overrides.shortDescription,
          description: overrides.description,
          brandId: overrides.brandId,
          status: 'ACTIVE',
          productType: overrides.productType ?? 'SIMPLE',
          basePrice: '25.00',
        },
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Relevance ranking', () => {
    it('ranks exact > prefix > contains > SKU > variant SKU > brand > category > shortDescription > description', async () => {
      const res = await api().get(`/api/v1/storefront/search?q=${encodeURIComponent(term)}&pageSize=50`);
      expect(res.status).toBe(200);
      const names: string[] = res.body.items.map((i: { name: string }) => i.name);

      const tierOrder = ['exact', 'prefix', 'contains', 'skuExact', 'variantSkuHost', 'brand', 'category', 'shortDesc', 'description'];
      const indices = tierOrder.map((key) => names.findIndex((n) => n.includes(key) || namesMatchesTier(n, key)));

      function namesMatchesTier(name: string, key: string): boolean {
        switch (key) {
          case 'exact':
            return name.toLowerCase() === term.toLowerCase();
          case 'prefix':
            return name === `${term}Extra`;
          case 'contains':
            return name === `Cool ${term} Item`;
          case 'skuExact':
            return name === 'Unrelated Name One';
          case 'variantSkuHost':
            return name === 'Unrelated Name Two';
          case 'brand':
            return name === 'Unrelated Name Three';
          case 'category':
            return name === 'Unrelated Name Four';
          case 'shortDesc':
            return name === 'Unrelated Name Five';
          case 'description':
            return name === 'Unrelated Name Six';
          default:
            return false;
        }
      }

      // Recompute indices using the precise matcher (the `.includes` fallback
      // above only helps for the `Cool <term> Item` style names).
      const preciseIndices = tierOrder.map((key) => names.findIndex((n) => namesMatchesTier(n, key)));
      expect(preciseIndices.every((i) => i !== -1)).toBe(true);
      for (let i = 1; i < preciseIndices.length; i += 1) {
        expect(preciseIndices[i - 1]).toBeLessThan(preciseIndices[i]);
      }
    });

    it('breaks ties between equal-relevance matches by newest createdAt first, deterministically', async () => {
      const res = await api().get(`/api/v1/storefront/search?q=${encodeURIComponent('Contains ' + term + ' Match')}&pageSize=10`);
      expect(res.status).toBe(200);
      const names: string[] = res.body.items.map((i: { name: string }) => i.name);
      const newerIndex = names.findIndex((n) => n.startsWith('Newer Contains'));
      const olderIndex = names.findIndex((n) => n.startsWith('Older Contains'));
      expect(newerIndex).toBeGreaterThanOrEqual(0);
      expect(olderIndex).toBeGreaterThanOrEqual(0);
      expect(newerIndex).toBeLessThan(olderIndex);
    });

    it('search is case-insensitive', async () => {
      const res = await api().get(`/api/v1/storefront/search?q=${encodeURIComponent(term.toUpperCase())}&pageSize=50`);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
    });
  });

  describe('Search safety - literal punctuation, never a SQL wildcard', () => {
    it('a literal underscore in the query is never treated as a single-character wildcard', async () => {
      const res = await api().get(`/api/v1/storefront/search?q=${encodeURIComponent(`abc_def${runId}`)}`);
      expect(res.status).toBe(200);
      const names: string[] = res.body.items.map((i: { name: string }) => i.name);
      expect(names).not.toContain(`abcQdef${runId}`);
    });

    it('a literal percent sign in the query only matches a product whose name genuinely contains it, never an unrelated decoy', async () => {
      const res = await api().get(`/api/v1/storefront/search?q=${encodeURIComponent(`50%OffSale${runId}`)}`);
      expect(res.status).toBe(200);
      const names: string[] = res.body.items.map((i: { name: string }) => i.name);
      expect(names).toContain(`50%OffSale${runId}`);
      expect(names).not.toContain(`50OffSaleDecoy${runId}`);
    });

    it('rejects a query longer than 200 characters', async () => {
      const res = await api().get(`/api/v1/storefront/search?q=${'a'.repeat(201)}`);
      expect(res.status).toBe(400);
    });
  });

  describe('Empty search', () => {
    it('an empty/missing q yields a clean, paginated discovery response, never the entire catalog unpaginated', async () => {
      const res = await api().get(`/api/v1/storefront/search?categorySlug=${sortCategorySlug}`);
      expect(res.status).toBe(200);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.items.length).toBe(3);
      expect(res.body.pagination.total).toBe(3);
    });

    it('whitespace-only q behaves the same as an empty q', async () => {
      const res = await api().get(`/api/v1/storefront/search?q=${encodeURIComponent('   ')}&categorySlug=${sortCategorySlug}`);
      expect(res.status).toBe(200);
      expect(res.body.pagination.total).toBe(3);
    });
  });

  describe('Filters', () => {
    it('price filter uses variant min/max for VARIABLE products, not basePrice', async () => {
      const res = await api().get(`/api/v1/storefront/search?categorySlug=${filterCategorySlug}&minPrice=120&maxPrice=200`);
      expect(res.status).toBe(200);
      const names: string[] = res.body.items.map((i: { name: string }) => i.name);
      expect(names).toContain(`P12 Priced Variable ${runId}`);
      expect(names).not.toContain(`P12 Cheap Simple ${runId}`);
    });

    it('brand filter restricts to the given brand', async () => {
      const res = await api().get(`/api/v1/storefront/search?brandSlug=${filterBrandSlug}`);
      expect(res.status).toBe(200);
      const names: string[] = res.body.items.map((i: { name: string }) => i.name);
      expect(names).toContain(`P12 Cheap Simple ${runId}`);
    });

    it('rejects maxPrice < minPrice as an invalid range', async () => {
      const res = await api().get(`/api/v1/storefront/search?categorySlug=${filterCategorySlug}&minPrice=500&maxPrice=1`);
      expect(res.status).toBe(400);
    });

    it('availability filter: IN_STOCK/LOW_STOCK/OUT_OF_STOCK each return exactly the matching fixture', async () => {
      const inStock = await api().get(`/api/v1/storefront/search?categorySlug=${availabilityCategorySlug}&availability=IN_STOCK`);
      expect(inStock.body.items.map((i: { name: string }) => i.name)).toEqual([`P12 InStock ${runId}`]);

      const lowStock = await api().get(`/api/v1/storefront/search?categorySlug=${availabilityCategorySlug}&availability=LOW_STOCK`);
      expect(lowStock.body.items.map((i: { name: string }) => i.name)).toEqual([`P12 LowStock ${runId}`]);

      const outOfStock = await api().get(`/api/v1/storefront/search?categorySlug=${availabilityCategorySlug}&availability=OUT_OF_STOCK`);
      expect(outOfStock.body.items.map((i: { name: string }) => i.name)).toEqual([`P12 OutOfStock ${runId}`]);
    });

    it('attribute filter requires a SINGLE variant to carry every requested value, not any variant matching any one value', async () => {
      const matching = await api().get(`/api/v1/storefront/search?q=${encodeURIComponent(attributeProductSlug)}&attributeValueIds=${redValueId},${sizeMValueId}`);
      // slug isn't searchable by `q` (only name/sku/description/brand/category
      // are) - use the category-free full listing instead, scoped by the
      // product's own distinct name.
      const byName = await api().get(`/api/v1/storefront/search?q=${encodeURIComponent(`P12 Attribute Product ${runId}`)}&attributeValueIds=${redValueId},${sizeMValueId}`);
      expect(byName.status).toBe(200);
      expect(byName.body.items.length).toBe(1);

      const nonMatching = await api().get(`/api/v1/storefront/search?q=${encodeURIComponent(`P12 Attribute Product ${runId}`)}&attributeValueIds=${redValueId},${sizeLValueId}`);
      expect(nonMatching.status).toBe(200);
      expect(nonMatching.body.items.length).toBe(0);
      void matching;
    });
  });

  describe('Sorting', () => {
    it('price_asc and price_desc use the whitelisted column only', async () => {
      const asc = await api().get(`/api/v1/storefront/search?categorySlug=${sortCategorySlug}&sortBy=price_asc`);
      expect(asc.body.items.map((i: { name: string }) => i.name)).toEqual([`Bravo Sort ${runId}`, `Charlie Sort ${runId}`, `Alpha Sort ${runId}`]);

      const desc = await api().get(`/api/v1/storefront/search?categorySlug=${sortCategorySlug}&sortBy=price_desc`);
      expect(desc.body.items.map((i: { name: string }) => i.name)).toEqual([`Alpha Sort ${runId}`, `Charlie Sort ${runId}`, `Bravo Sort ${runId}`]);
    });

    it('name_asc and name_desc', async () => {
      const asc = await api().get(`/api/v1/storefront/search?categorySlug=${sortCategorySlug}&sortBy=name_asc`);
      expect(asc.body.items.map((i: { name: string }) => i.name)).toEqual([`Alpha Sort ${runId}`, `Bravo Sort ${runId}`, `Charlie Sort ${runId}`]);

      const desc = await api().get(`/api/v1/storefront/search?categorySlug=${sortCategorySlug}&sortBy=name_desc`);
      expect(desc.body.items.map((i: { name: string }) => i.name)).toEqual([`Charlie Sort ${runId}`, `Bravo Sort ${runId}`, `Alpha Sort ${runId}`]);
    });

    it('newest sorts by createdAt descending', async () => {
      const res = await api().get(`/api/v1/storefront/search?categorySlug=${sortCategorySlug}&sortBy=newest`);
      expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([`Charlie Sort ${runId}`, `Bravo Sort ${runId}`, `Alpha Sort ${runId}`]);
    });

    it('an arbitrary, non-whitelisted sortBy value is rejected, never passed through to SQL', async () => {
      const res = await api().get(`/api/v1/storefront/search?categorySlug=${sortCategorySlug}&sortBy=${encodeURIComponent('"; DROP TABLE products; --')}`);
      expect(res.status).toBe(400);
    });
  });

  describe('Pagination', () => {
    it('page 1 and the last page behave correctly, and beyond-last-page returns an empty (not erroring) page', async () => {
      const page1 = await api().get(`/api/v1/storefront/search?categorySlug=${sortCategorySlug}&pageSize=2&page=1`);
      expect(page1.body.items.length).toBe(2);
      expect(page1.body.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });

      const page2 = await api().get(`/api/v1/storefront/search?categorySlug=${sortCategorySlug}&pageSize=2&page=2`);
      expect(page2.body.items.length).toBe(1);

      const beyond = await api().get(`/api/v1/storefront/search?categorySlug=${sortCategorySlug}&pageSize=2&page=99`);
      expect(beyond.status).toBe(200);
      expect(beyond.body.items.length).toBe(0);
      expect(beyond.body.pagination.total).toBe(3);
    });

    it('rejects an invalid page number and an invalid/oversized pageSize', async () => {
      expect((await api().get('/api/v1/storefront/search?page=0')).status).toBe(400);
      expect((await api().get('/api/v1/storefront/search?page=abc')).status).toBe(400);
      expect((await api().get('/api/v1/storefront/search?pageSize=0')).status).toBe(400);
      expect((await api().get('/api/v1/storefront/search?pageSize=101')).status).toBe(400);
    });

    it('accepts the maximum allowed pageSize (100)', async () => {
      const res = await api().get('/api/v1/storefront/search?pageSize=100');
      expect(res.status).toBe(200);
      expect(res.body.pagination.pageSize).toBe(100);
    });
  });

  describe('Security & tenant isolation', () => {
    it('never returns another store\'s product, even with an identical matching keyword', async () => {
      const res = await api().get(`/api/v1/storefront/search?q=${encodeURIComponent(term)}&pageSize=50`);
      expect(res.status).toBe(200);
      const slugs: string[] = res.body.items.map((i: { slug: string }) => i.slug);
      expect(slugs).not.toContain(storeBProductSlug);
    });

    it('search never requires an Authorization header', async () => {
      const res = await api().get(`/api/v1/storefront/search?q=${encodeURIComponent(term)}`);
      expect(res.status).toBe(200);
    });

    it('search results never leak internal fields (cost price, barcode, raw inventory quantities)', async () => {
      const res = await api().get(`/api/v1/storefront/search?q=${encodeURIComponent(term)}&pageSize=50`);
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toMatch(/costPrice/);
      expect(serialized).not.toMatch(/onHandQuantity/);
      expect(serialized).not.toMatch(/reservedQuantity/);
    });
  });

  describe('Sitemap support endpoints', () => {
    it('products sitemap feed only includes ACTIVE, non-deleted, store-scoped products, and paginates by cursor', async () => {
      const draft = await prisma.product.create({ data: { storeId, name: `P12 Sitemap Draft ${runId}`, slug: `p12-sitemap-draft-${runId}`, sku: `P12-SMD-${runId}`, status: 'DRAFT', basePrice: '1.00' } });
      const deleted = await prisma.product.create({ data: { storeId, name: `P12 Sitemap Deleted ${runId}`, slug: `p12-sitemap-deleted-${runId}`, sku: `P12-SMDEL-${runId}`, status: 'ACTIVE', basePrice: '1.00', deletedAt: new Date() } });

      const page1 = await api().get('/api/v1/storefront/sitemap/products?limit=1');
      expect(page1.status).toBe(200);
      expect(page1.body.items.length).toBe(1);
      expect(page1.body.nextCursor).toBeTruthy();

      let cursor = page1.body.nextCursor as string;
      const allSlugs: string[] = [...page1.body.items.map((i: { slug: string }) => i.slug)];
      for (let i = 0; i < 500 && cursor; i += 1) {
        const page = await api().get(`/api/v1/storefront/sitemap/products?limit=200&cursor=${cursor}`);
        allSlugs.push(...page.body.items.map((it: { slug: string }) => it.slug));
        cursor = page.body.nextCursor;
      }

      expect(allSlugs).not.toContain(draft.slug);
      expect(allSlugs).not.toContain(deleted.slug);
      expect(allSlugs).not.toContain(storeBProductSlug);
    });

    it('categories and brands sitemap feeds only include active, non-deleted, store-scoped entries', async () => {
      const inactiveCategory = await prisma.category.create({ data: { storeId, name: `P12 Sitemap Inactive Cat ${runId}`, slug: `p12-sitemap-inactive-cat-${runId}`, isActive: false } });
      const inactiveBrand = await prisma.brand.create({ data: { storeId, name: `P12 Sitemap Inactive Brand ${runId}`, slug: `p12-sitemap-inactive-brand-${runId}`, isActive: false } });

      const categories = await api().get('/api/v1/storefront/sitemap/categories');
      expect(categories.status).toBe(200);
      const categorySlugs = categories.body.items.map((i: { slug: string }) => i.slug);
      expect(categorySlugs).toContain(filterCategorySlug);
      expect(categorySlugs).not.toContain(inactiveCategory.slug);

      const brands = await api().get('/api/v1/storefront/sitemap/brands');
      expect(brands.status).toBe(200);
      const brandSlugs = brands.body.items.map((i: { slug: string }) => i.slug);
      expect(brandSlugs).toContain(filterBrandSlug);
      expect(brandSlugs).not.toContain(inactiveBrand.slug);
    });
  });

  describe('Database invariants', () => {
    it('no search-relevant orphan product/category or product/brand relationships exist for this store', async () => {
      const orphanCategoryLinks = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::int c FROM product_categories pc
        JOIN products p ON p.id = pc."productId" AND p."storeId" = ${storeId}
        LEFT JOIN categories c ON c.id = pc."categoryId"
        WHERE c.id IS NULL`;
      expect(Number(orphanCategoryLinks[0].c)).toBe(0);

      const invalidBrandLinks = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::int c FROM products p
        LEFT JOIN brands b ON b.id = p."brandId"
        WHERE p."storeId" = ${storeId} AND p."brandId" IS NOT NULL AND b.id IS NULL`;
      expect(Number(invalidBrandLinks[0].c)).toBe(0);
    });
  });
});
