import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export const GUEST_CART_COOKIE = 'peshani_guest_cart_token';
export const ACCESS_TOKEN_COOKIE = 'peshani_access_token';

const GUEST_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Generic same-origin proxy to the NestJS API, used by every Route Handler
 * under /api/cart, /api/checkout, /api/orders and /api/payments - it
 * forwards the access-token cookie (HttpOnly, set at login) as a Bearer
 * header and the guest-cart cookie as its own header, and relays whatever
 * the API returns. The API itself never sees a cookie, only headers - see
 * cart-proxy.ts's original doc comment for why.
 */
export async function proxyApiRequest(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<NextResponse> {
  const cookieStore = await cookies();
  const guestToken = cookieStore.get(GUEST_CART_COOKIE)?.value;
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  const headers: Record<string, string> = { ...extraHeaders };
  if (guestToken) headers['X-Guest-Cart-Token'] = guestToken;
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let apiResponse: Response;
  try {
    apiResponse = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ message: 'Service is temporarily unavailable' }, { status: 503 });
  }

  const text = await apiResponse.text();
  const data = text ? JSON.parse(text) : null;
  const response = NextResponse.json(data, { status: apiResponse.status });

  const newGuestToken = apiResponse.headers.get('x-guest-cart-token');
  if (newGuestToken) {
    response.cookies.set(GUEST_CART_COOKIE, newGuestToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: GUEST_COOKIE_MAX_AGE_SECONDS,
    });
  }

  return response;
}

/**
 * Same auth-forwarding contract as proxyApiRequest, but for a multipart body
 * (currently only /returns/:id/evidence file uploads). The incoming request
 * is already a FormData (built by the Route Handler from the browser's
 * multipart body), so it's forwarded as-is - fetch sets its own
 * `multipart/form-data; boundary=...` Content-Type for a FormData body, so we
 * must not set Content-Type ourselves here.
 */
export async function proxyMultipartRequest(path: string, formData: FormData): Promise<NextResponse> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  const headers: Record<string, string> = {};
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  let apiResponse: Response;
  try {
    apiResponse = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: formData,
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ message: 'Service is temporarily unavailable' }, { status: 503 });
  }

  const text = await apiResponse.text();
  const data = text ? JSON.parse(text) : null;
  return NextResponse.json(data, { status: apiResponse.status });
}
