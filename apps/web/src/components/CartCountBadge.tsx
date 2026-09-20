'use client';

import Link from 'next/link';
import { useCart } from '../lib/cart-context';

export function CartCountBadge() {
  const { cart } = useCart();
  const count = cart?.itemCount ?? 0;

  return (
    <Link href="/cart" aria-label={`View cart${count > 0 ? ` (${count} item${count === 1 ? '' : 's'})` : ''}`} className="site-header__icon-link">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M6 7h12l1 13H5L6 7Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M9 7V6a3 3 0 0 1 6 0v1" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
      {count > 0 && <span className="site-header__icon-badge">{count > 99 ? '99+' : count}</span>}
    </Link>
  );
}
