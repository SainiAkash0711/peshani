'use client';

import Link from 'next/link';
import { useWishlist } from '../lib/wishlist-context';

export function WishlistCountBadge() {
  const { wishlist } = useWishlist();
  const count = wishlist?.items.length ?? 0;

  return (
    <Link href="/wishlist" aria-label={`View wishlist${count > 0 ? ` (${count} item${count === 1 ? '' : 's'})` : ''}`} className="site-header__icon-link">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          d="M12 20.25c-.3 0-.6-.1-.83-.32C7.1 16.5 3 12.9 3 8.9 3 6.2 5.1 4 7.75 4c1.5 0 2.94.72 3.83 1.9L12 6.4l.42-.5C13.31 4.72 14.75 4 16.25 4 18.9 4 21 6.2 21 8.9c0 4-4.1 7.6-8.17 11.03-.23.22-.53.32-.83.32Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      </svg>
      {count > 0 && <span className="site-header__icon-badge">{count > 99 ? '99+' : count}</span>}
    </Link>
  );
}
