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
        <nav className="site-header__nav">
          <Link href="/products">All Products</Link>
          <Link href="/categories">Categories</Link>
          <Link href="/brands">Brands</Link>
          <AuthStatusLink />
          <NotificationBell />
          <WishlistCountBadge />
          <CartCountBadge />
        </nav>
      </div>
    </header>
  );
}
