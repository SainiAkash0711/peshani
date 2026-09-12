'use client';

import Link from 'next/link';
import { useCart } from '../lib/cart-context';

export function CartCountBadge() {
  const { cart } = useCart();
  const count = cart?.itemCount ?? 0;

  return (
    <Link href="/cart" aria-label="View cart">
      Cart{count > 0 ? ` (${count})` : ''}
    </Link>
  );
}
