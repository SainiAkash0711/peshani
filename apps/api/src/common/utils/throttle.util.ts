/**
 * A single e2e test file can legitimately make far more requests per minute
 * than any real customer (dozens of login/checkout/payment scenarios in one
 * run) - raising every individual @Throttle() limit to accommodate that
 * would mean guessing a "big enough" number per route forever. Setting
 * THROTTLE_TEST_MODE=true (local/test env only - never set in a real
 * deployment) instead raises every rate limit sharing this helper to a
 * ceiling no real test run will hit, without touching the actual production
 * default each route falls back to.
 */
export function throttleLimit(productionDefault: number): number {
  return process.env.THROTTLE_TEST_MODE === 'true' ? 100_000 : productionDefault;
}
