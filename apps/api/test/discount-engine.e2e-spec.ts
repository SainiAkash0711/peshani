import { Prisma } from '@prisma/client';
import { DiscountEngineService, DiscountConfig, PromotionTargeting, DiscountLine } from '../src/modules/promotions/discount-engine.service';

/**
 * Phase 7 §73 - pure discount-math unit tests. No HTTP, no database, no
 * Nest test module - DiscountEngineService is a plain stateless class, so
 * these instantiate it directly. Named .e2e-spec.ts only so it runs
 * alongside the rest of the suite through the project's single existing
 * jest config (test/jest-e2e.json's testRegex) rather than introducing a
 * second test-running setup for a small number of pure tests.
 */
describe('DiscountEngineService (pure unit tests)', () => {
  const engine = new DiscountEngineService();

  const storeWideTargeting: PromotionTargeting = {
    includedProductIds: new Set(),
    excludedProductIds: new Set(),
    includedCategoryIds: new Set(),
    excludedCategoryIds: new Set(),
    includedBrandIds: new Set(),
    excludedBrandIds: new Set(),
  };

  function line(productId: string, lineTotal: string, opts?: { categoryIds?: string[]; brandId?: string | null }): DiscountLine {
    return { productId, lineTotal: new Prisma.Decimal(lineTotal), categoryIds: opts?.categoryIds ?? [], brandId: opts?.brandId ?? null };
  }

  function percentageConfig(value: string, max?: string, min?: string): DiscountConfig {
    return {
      discountType: 'PERCENTAGE',
      value: new Prisma.Decimal(value),
      maximumDiscountAmount: max ? new Prisma.Decimal(max) : null,
      minimumOrderAmount: min ? new Prisma.Decimal(min) : null,
    };
  }

  function fixedConfig(value: string, min?: string): DiscountConfig {
    return { discountType: 'FIXED_AMOUNT', value: new Prisma.Decimal(value), maximumDiscountAmount: null, minimumOrderAmount: min ? new Prisma.Decimal(min) : null };
  }

  it('percentage: 10% of ₹1,000 = ₹100', () => {
    const lines = [line('p1', '1000.00')];
    const result = engine.calculate(percentageConfig('10'), storeWideTargeting, lines, new Prisma.Decimal('1000.00'));
    expect(result.eligible).toBe(true);
    if (result.eligible) expect(result.discountAmount.toFixed(2)).toBe('100.00');
  });

  it('percentage with cap: 20% of ₹2,000 = ₹400, capped at ₹250 -> ₹250', () => {
    const lines = [line('p1', '2000.00')];
    const result = engine.calculate(percentageConfig('20', '250.00'), storeWideTargeting, lines, new Prisma.Decimal('2000.00'));
    expect(result.eligible).toBe(true);
    if (result.eligible) expect(result.discountAmount.toFixed(2)).toBe('250.00');
  });

  it('fixed amount: ₹300 off ₹1,000 = ₹300', () => {
    const lines = [line('p1', '1000.00')];
    const result = engine.calculate(fixedConfig('300'), storeWideTargeting, lines, new Prisma.Decimal('1000.00'));
    expect(result.eligible).toBe(true);
    if (result.eligible) expect(result.discountAmount.toFixed(2)).toBe('300.00');
  });

  it('fixed amount greater than eligible: ₹1,500 off ₹1,000 eligible = ₹1,000 (never exceeds eligible amount)', () => {
    const lines = [line('p1', '1000.00')];
    const result = engine.calculate(fixedConfig('1500'), storeWideTargeting, lines, new Prisma.Decimal('1000.00'));
    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.discountAmount.toFixed(2)).toBe('1000.00');
      expect(result.discountAmount.lessThanOrEqualTo(result.eligibleAmount)).toBe(true);
    }
  });

  it('discount is never negative', () => {
    const lines = [line('p1', '100.00')];
    const result = engine.calculate(fixedConfig('300'), storeWideTargeting, lines, new Prisma.Decimal('100.00'));
    expect(result.eligible).toBe(true);
    if (result.eligible) expect(result.discountAmount.greaterThanOrEqualTo(0)).toBe(true);
  });

  it('category targeting: only the matching category is discounted', () => {
    const targeting: PromotionTargeting = { ...storeWideTargeting, includedCategoryIds: new Set(['electronics']) };
    const lines = [line('p1', '1000.00', { categoryIds: ['electronics'] }), line('p2', '2000.00', { categoryIds: ['clothing'] })];
    const result = engine.calculate(percentageConfig('10'), targeting, lines, new Prisma.Decimal('3000.00'));
    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.eligibleAmount.toFixed(2)).toBe('1000.00');
      expect(result.discountAmount.toFixed(2)).toBe('100.00'); // NOT 300 (10% of the whole 3000).
    }
  });

  it('brand targeting: only the matching brand is discounted', () => {
    const targeting: PromotionTargeting = { ...storeWideTargeting, includedBrandIds: new Set(['nike']) };
    const lines = [line('p1', '500.00', { brandId: 'nike' }), line('p2', '500.00', { brandId: 'adidas' })];
    const result = engine.calculate(percentageConfig('10'), targeting, lines, new Prisma.Decimal('1000.00'));
    expect(result.eligible).toBe(true);
    if (result.eligible) expect(result.discountAmount.toFixed(2)).toBe('50.00');
  });

  it('product targeting: only the matching product is discounted', () => {
    const targeting: PromotionTargeting = { ...storeWideTargeting, includedProductIds: new Set(['p1']) };
    const lines = [line('p1', '500.00'), line('p2', '2000.00')];
    const result = engine.calculate(fixedConfig('100'), targeting, lines, new Prisma.Decimal('2500.00'));
    expect(result.eligible).toBe(true);
    if (result.eligible) expect(result.eligibleAmount.toFixed(2)).toBe('500.00');
  });

  it('exclusion always overrides inclusion: an excluded product gets ₹0 discount even though its category matches', () => {
    const targeting: PromotionTargeting = {
      ...storeWideTargeting,
      includedCategoryIds: new Set(['electronics']),
      excludedProductIds: new Set(['p1']),
    };
    const lines = [line('p1', '1000.00', { categoryIds: ['electronics'] }), line('p2', '500.00', { categoryIds: ['electronics'] })];
    const result = engine.calculate(percentageConfig('10'), targeting, lines, new Prisma.Decimal('1500.00'));
    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.eligibleAmount.toFixed(2)).toBe('500.00'); // only p2.
      expect(result.discountAmount.toFixed(2)).toBe('50.00');
    }
  });

  it('quantity is already folded into lineTotal: ₹500 x 3 with 10% = ₹150', () => {
    const lines = [line('p1', (500 * 3).toFixed(2))];
    const result = engine.calculate(percentageConfig('10'), storeWideTargeting, lines, new Prisma.Decimal('1500.00'));
    expect(result.eligible).toBe(true);
    if (result.eligible) expect(result.discountAmount.toFixed(2)).toBe('150.00');
  });

  it('minimum order: ₹999 subtotal against a ₹1,000 minimum is ineligible', () => {
    const lines = [line('p1', '999.00')];
    const result = engine.calculate(percentageConfig('10', undefined, '1000.00'), storeWideTargeting, lines, new Prisma.Decimal('999.00'));
    expect(result.eligible).toBe(false);
  });

  it('no eligible lines at all (targeting matches nothing) is ineligible', () => {
    const targeting: PromotionTargeting = { ...storeWideTargeting, includedProductIds: new Set(['other-product']) };
    const lines = [line('p1', '1000.00')];
    const result = engine.calculate(percentageConfig('10'), targeting, lines, new Prisma.Decimal('1000.00'));
    expect(result.eligible).toBe(false);
  });
});
