import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ACCESS_TOKEN_COOKIE, GUEST_CART_COOKIE } from './cart-proxy';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';
export const REFRESH_TOKEN_COOKIE = 'peshani_refresh_token';

const ACCESS_COOKIE_MAX_AGE_SECONDS = 15 * 60;
const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const secureCookie = process.env.NODE_ENV === 'production';

function authCookieOptions(maxAge: number) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: secureCookie, path: '/', maxAge };
}

/**
 * Login is the one moment a guest identity becomes a known customer - the
 * current guest-cart cookie (if any) is forwarded to the API so it can merge
 * that cart into the customer's own (see CartService.mergeGuestCartIntoUser
 * on the API side), and is cleared here afterward since it's now consumed
 * (status MERGED) - a stale guest cookie must never linger past that point.
 *
 * Access/refresh tokens are stored as HttpOnly cookies by THIS Next.js
 * server, never handed to client-side JS - a meaningfully more defensive
 * posture against XSS than keeping them in localStorage/memory.
 */
export async function proxyLogin(body: unknown): Promise<NextResponse> {
  const cookieStore = await cookies();
  const guestToken = cookieStore.get(GUEST_CART_COOKIE)?.value;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (guestToken) headers['X-Guest-Cart-Token'] = guestToken;

  const apiResponse = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const data = await apiResponse.json();
  if (!apiResponse.ok) {
    return NextResponse.json(data, { status: apiResponse.status });
  }

  const { accessToken, refreshToken, ...rest } = data;
  const response = NextResponse.json(rest, { status: apiResponse.status });
  response.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, authCookieOptions(ACCESS_COOKIE_MAX_AGE_SECONDS));
  response.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, authCookieOptions(REFRESH_COOKIE_MAX_AGE_SECONDS));
  response.cookies.delete(GUEST_CART_COOKIE);
  return response;
}

export async function proxyRegister(body: unknown): Promise<NextResponse> {
  const apiResponse = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await apiResponse.json();
  return NextResponse.json(data, { status: apiResponse.status });
}

/**
 * Logout deliberately does NOT touch the guest-cart cookie (section 22 of
 * the Phase 4 spec) - the authenticated cart stays with the account, and
 * anonymous browsing afterward lazily gets its own fresh guest cart the
 * next time a cart action happens, never by reusing anything from the
 * session that just ended.
 */
export async function proxyLogout(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;

  if (refreshToken) {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    }).catch(() => undefined);
  }

  const response = NextResponse.json({ success: true });
  response.cookies.delete(ACCESS_TOKEN_COOKIE);
  response.cookies.delete(REFRESH_TOKEN_COOKIE);
  return response;
}

export async function proxyGetProfile(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const apiResponse = await fetch(`${API_BASE_URL}/auth/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  const data = await apiResponse.json();
  return NextResponse.json(data, { status: apiResponse.status });
}

export async function proxyUpdateProfile(body: unknown): Promise<NextResponse> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const apiResponse = await fetch(`${API_BASE_URL}/auth/profile`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await apiResponse.json();
  return NextResponse.json(data, { status: apiResponse.status });
}

export async function proxyMe(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ user: null });
  }

  const apiResponse = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!apiResponse.ok) {
    const response = NextResponse.json({ user: null });
    response.cookies.delete(ACCESS_TOKEN_COOKIE);
    response.cookies.delete(REFRESH_TOKEN_COOKIE);
    return response;
  }
  const user = await apiResponse.json();
  return NextResponse.json({ user });
}
