import Link from 'next/link';
import { getStoreSettings } from '../lib/api';
import { CartCountBadge } from './CartCountBadge';
import { WishlistCountBadge } from './WishlistCountBadge';
import { NotificationBell } from './NotificationBell';
import { AuthStatusLink } from './AuthStatusLink';

export async function Header() {
  const settings = await getStoreSettings();

  return (
    <header className="site-header">
      <div className="container site-header__bar">
        <Link href="/" className="site-header__brand">
          {settings.storeName}
        </Link>
        {/* Plain GET form to /search - no client JS needed, works even with
            JavaScript disabled, and reuses the existing /search page/API
            exactly as its own search box does. */}
        <form action="/search" method="GET" role="search" className="site-header__search">
          <input type="search" name="q" placeholder="Search products..." aria-label="Search products" />
          <button type="submit" aria-label="Search">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M10 4a6 6 0 1 0 3.76 10.66l4.79 4.8 1.41-1.42-4.79-4.79A6 6 0 0 0 10 4Zm-4 6a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </form>
        {/* CSS-only mobile menu toggle - no client JS needed. The checkbox
            is visually hidden; the label acts as the hamburger button via
            `for`, and `:checked ~ .site-header__nav` (see globals.css)
            reveals the nav as a dropdown panel below ~800px. */}
        <input type="checkbox" id="site-nav-toggle" className="site-header__nav-toggle-input" />
        <label htmlFor="site-nav-toggle" className="site-header__nav-toggle" aria-label="Toggle menu">
          <span></span>
          <span></span>
          <span></span>
        </label>
        <nav className="site-header__nav">
          <Link href="/products" className="site-header__nav-link">
            All Products
          </Link>
          <Link href="/categories" className="site-header__nav-link">
            Categories
          </Link>
          <Link href="/brands" className="site-header__nav-link">
            Brands
          </Link>
          <Link href="/blogs" className="site-header__nav-link">
            Blog
          </Link>
          <AuthStatusLink />
          <NotificationBell />
          <WishlistCountBadge />
          <CartCountBadge />
        </nav>
      </div>
    </header>
  );
}
