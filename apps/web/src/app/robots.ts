import type { MetadataRoute } from 'next';
import { SITE_URL } from '../lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/cart',
        '/checkout',
        '/account',
        '/orders',
        '/returns',
        '/wishlist',
        '/notifications',
        '/login',
        '/register',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
