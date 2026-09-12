const API_ORIGIN = new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1').origin;

/**
 * Mirrors next.config.mjs's `images.remotePatterns` allowlist (same origin
 * as the API, path under /media/) - `next/image` throws an UNCAUGHT error
 * (crashing the whole page, not just one card) for any src outside that
 * allowlist. A single corrupted/stale/malicious image URL on one product
 * must never be able to take down an entire listing page, so every call
 * site rendering an API-supplied image URL checks this first and falls
 * back to a placeholder instead of ever handing next/image a disallowed src.
 */
export function isAllowedImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === API_ORIGIN && parsed.pathname.startsWith('/media/');
  } catch {
    return false;
  }
}
