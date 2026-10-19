import Link from 'next/link';
import { getCategoryTree, getStoreSettings } from '../lib/api';
import { Logo } from './Logo';

const HELP_LINKS = [
  { href: '/orders', label: 'Track my orders' },
  { href: '/returns', label: 'Returns & refunds' },
  { href: '/wishlist', label: 'My wishlist' },
  { href: '/account/profile', label: 'My account' },
];

const DISCOVER_LINKS = [
  { href: '/products', label: 'All products' },
  { href: '/categories', label: 'All categories' },
  { href: '/brands', label: 'Brands' },
  { href: '/blogs', label: 'Blog & stories' },
];

function whatsappHref(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}`;
}

export async function Footer() {
  const [settings, categories] = await Promise.all([getStoreSettings(), getCategoryTree()]);
  const topCategories = categories.slice(0, 6);
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="container site-footer__grid">
        <div className="site-footer__brand">
          <Link href="/" className="site-footer__logo">
            <Logo name={settings.storeName} />
          </Link>
          <p>
            {settings.storeDescription ??
              'Natural and handmade goods, thoughtfully chosen and delivered with care.'}
          </p>
          <ul className="site-footer__contact">
            {settings.supportEmail && (
              <li>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 1.5 8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                </svg>
                <a href={`mailto:${settings.supportEmail}`}>{settings.supportEmail}</a>
              </li>
            )}
            {settings.supportPhone && (
              <li>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8Z" fill="currentColor" />
                </svg>
                <a href={whatsappHref(settings.supportPhone)} target="_blank" rel="noopener noreferrer">
                  {settings.supportPhone} <span className="site-footer__tag">WhatsApp</span>
                </a>
              </li>
            )}
          </ul>
        </div>

        {topCategories.length > 0 && (
          <nav className="site-footer__col" aria-label="Shop categories">
            <h3>Shop</h3>
            <ul>
              {topCategories.map((category) => (
                <li key={category.id}>
                  <Link href={`/categories/${category.slug}`}>{category.name}</Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <nav className="site-footer__col" aria-label="Discover">
          <h3>Discover</h3>
          <ul>
            {DISCOVER_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav className="site-footer__col" aria-label="Customer help">
          <h3>Help</h3>
          <ul>
            {HELP_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="site-footer__bottom">
        <div className="container site-footer__bottom-inner">
          <span>
            &copy; {year} {settings.storeName}. All rights reserved.
          </span>
          <span className="site-footer__secure">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M6 10V8a6 6 0 1 1 12 0v2h1v11H5V10h1Zm2 0h8V8a4 4 0 1 0-8 0v2Z" fill="currentColor" />
            </svg>
            Secure checkout
          </span>
        </div>
      </div>
    </footer>
  );
}
