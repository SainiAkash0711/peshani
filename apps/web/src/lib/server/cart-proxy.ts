import { proxyApiRequest, ACCESS_TOKEN_COOKIE, GUEST_CART_COOKIE } from './api-proxy';

export { ACCESS_TOKEN_COOKIE, GUEST_CART_COOKIE };

/** Thin cart-flavored alias over the generic API proxy - see api-proxy.ts. */
export async function proxyCartRequest(path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
  return proxyApiRequest(path, method, body);
}
