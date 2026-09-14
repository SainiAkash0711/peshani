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
          <Link href="/products">All Products</Link>
          <Link href="/categories">Categories</Link>
          <Link href="/brands">Brands</Link>
          <Link href="/blogs">Blog</Link>
          <AuthStatusLink />
          <NotificationBell />
          <WishlistCountBadge />
          <CartCountBadge />
        </nav>
      </div>
    </header>
  );
}
