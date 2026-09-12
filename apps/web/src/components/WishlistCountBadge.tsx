'use client';

import Link from 'next/link';
import { useWishlist } from '../lib/wishlist-context';

export function WishlistCountBadge() {
  const { wishlist } = useWishlist();
  const count = wishlist?.items.length ?? 0;

  return (
    <Link href="/wishlist" aria-label="View wishlist">
      Wishlist{count > 0 ? ` (${count})` : ''}
    </Link>
  );
}
