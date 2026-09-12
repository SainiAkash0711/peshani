const apiUrl = new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1');
const apiOrigin = apiUrl.origin;

// Razorpay Checkout is the one third-party script this storefront loads
// client-side (apps/web/src/lib/razorpay-checkout.ts) - its hosted script,
// the iframe/popup it opens, and its own API calls all need explicit CSP
// allowances. `unsafe-inline` on script-src/style-src is a documented,
// deliberate exception: Next.js's own hydration bootstrap and this app's
// inline JSON-LD <script type="application/ld+json"> tags both require it,
// and a nonce-based CSP (the alternative that would avoid it) is a larger
// undertaking than this phase's scope - see the Phase 13 report.
// `next dev`'s webpack HMR/fast-refresh runtime evaluates code via eval(),
// which a strict script-src silently breaks - the browser blocks it with a
// CSP EvalError, which in turn crashes hydration for every client
// component on the page (confirmed live: the header's Sign In/Sign Up,
// notification bell, and cart/wishlist counts all failed to render because
// of this, not a bug in those components themselves). Production builds
// never eval() code, so 'unsafe-eval' must never be added there - it would
// be a real CSP weakening with no matching production need.
const scriptSrc = process.env.NODE_ENV === 'production'
  ? `script-src 'self' 'unsafe-inline' https://checkout.razorpay.com`
  : `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com`;

const CSP = [
  "default-src 'self'",
  scriptSrc,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: ${apiOrigin} https://*.razorpay.com`,
  `connect-src 'self' ${apiOrigin} https://*.razorpay.com https://lumberjack.razorpay.com`,
  `frame-src https://*.razorpay.com https://api.razorpay.com`,
  `font-src 'self' data:`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Docker/production: traces only the files actually needed to run
  // `node server.js` (no full node_modules copy required in the runtime
  // image) - see the Phase 14 report's Docker section and apps/web/Dockerfile.
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        // Derived from NEXT_PUBLIC_API_BASE_URL (the same source the CSP
        // directives above already use) rather than a hardcoded
        // 'localhost:4000' - previously hardcoded, which meant a non-local
        // API origin in any real deployment silently would never match,
        // breaking next/image for every product photo.
        protocol: apiUrl.protocol.replace(':', ''),
        hostname: apiUrl.hostname,
        port: apiUrl.port,
        pathname: '/media/**',
      },
    ],
  },
  async headers() {
    const headers = [
      { key: 'Content-Security-Policy', value: CSP },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ];
    // HSTS forces the browser to remember "always use HTTPS for this host"
    // for the given max-age - enabling it in local HTTP development would
    // make http://localhost unusable after the first request. Production-only.
    if (process.env.NODE_ENV === 'production') {
      headers.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' });
    }
    return [{ source: '/:path*', headers }];
  },
};

export default nextConfig;
