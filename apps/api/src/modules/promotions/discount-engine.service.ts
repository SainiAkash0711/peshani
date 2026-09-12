import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface DiscountLine {
  productId: string;
  categoryIds: string[];
  brandId: string | null;
  lineTotal: Prisma.Decimal;
}

export interface PromotionTargeting {
  includedProductIds: ReadonlySet<string>;
  excludedProductIds: ReadonlySet<string>;
  includedCategoryIds: ReadonlySet<string>;
  excludedCategoryIds: ReadonlySet<string>;
  includedBrandIds: ReadonlySet<string>;
  excludedBrandIds: ReadonlySet<string>;
}

export interface DiscountConfig {
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: Prisma.Decimal;
  maximumDiscountAmount: Prisma.Decimal | null;
  minimumOrderAmount: Prisma.Decimal | null;
}

export type DiscountCalculationResult =
  | { eligible: true; eligibleAmount: Prisma.Decimal; discountAmount: Prisma.Decimal }
  | { eligible: false; reason: string };

const ZERO = new Prisma.Decimal(0);

/**
 * Phase 7 - the ONE place discount eligibility and amount are computed
 * (§22). Pure and stateless: takes fully-resolved, already-authoritative
 * data (no DB access here at all) and returns a structured result, so it is
 * trivially unit-testable and reusable identically from both the
 * customer-facing preview endpoint and the authoritative checkout
 * transaction - the two callers can never disagree about the math because
 * they call the exact same code.
 */
@Injectable()
export class DiscountEngineService {
  /**
   * Targeting semantics (§13/§14): a line is eligible if it is NOT excluded
   * (by product, category, or brand - exclusion always overrides inclusion)
   * AND (no include-rows exist at all for this promotion, i.e. store-wide,
   * OR the line matches by product, category, or brand).
   */
  isLineEligible(line: DiscountLine, targeting: PromotionTargeting): boolean {
    if (targeting.excludedProductIds.has(line.productId)) return false;
    if (line.brandId && targeting.excludedBrandIds.has(line.brandId)) return false;
    if (line.categoryIds.some((id) => targeting.excludedCategoryIds.has(id))) return false;

    const hasAnyIncludeTarget =
      targeting.includedProductIds.size > 0 || targeting.includedCategoryIds.size > 0 || targeting.includedBrandIds.size > 0;
    if (!hasAnyIncludeTarget) return true; // store-wide.

    if (targeting.includedProductIds.has(line.productId)) return true;
    if (line.brandId && targeting.includedBrandIds.has(line.brandId)) return true;
    if (line.categoryIds.some((id) => targeting.includedCategoryIds.has(id))) return true;
    return false;
  }

  /**
   * @param subtotal the FULL merchandise subtotal (before discount) - used
   *   only for the minimumOrderAmount check (§18), never for the discount
   *   amount itself (that is always based on eligibleAmount, §15).
   */
  calculate(config: DiscountConfig, targeting: PromotionTargeting, lines: DiscountLine[], subtotal: Prisma.Decimal): DiscountCalculationResult {
    if (config.minimumOrderAmount && subtotal.lessThan(config.minimumOrderAmount)) {
      return { eligible: false, reason: `Minimum order amount of ${config.minimumOrderAmount.toFixed(2)} not met` };
    }

    const eligibleAmount = lines
      .filter((line) => this.isLineEligible(line, targeting))
      .reduce((sum, line) => sum.plus(line.lineTotal), ZERO);

    if (eligibleAmount.lessThanOrEqualTo(0)) {
      return { eligible: false, reason: 'No eligible items in cart for this coupon' };
    }

    let discountAmount: Prisma.Decimal;
    if (config.discountType === 'PERCENTAGE') {
      const raw = eligibleAmount.times(config.value).dividedBy(100);
      discountAmount = config.maximumDiscountAmount ? Prisma.Decimal.min(raw, config.maximumDiscountAmount) : raw;
    } else {
      discountAmount = config.value;
    }

    // §19/§20: never exceed the eligible amount, never negative.
    discountAmount = Prisma.Decimal.min(discountAmount, eligibleAmount);
    if (discountAmount.lessThan(0)) discountAmount = ZERO;

    return { eligible: true, eligibleAmount, discountAmount };
  }
}
