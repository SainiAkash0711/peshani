'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '../../lib/auth-context';
import { useWishlist } from '../../lib/wishlist-context';
import { formatPrice } from '../../lib/format';
import type { WishlistItemDetail } from '../../types/wishlist';

function WishlistRow({ item }: { item: WishlistItemDetail }) {
  const { removeItem, moveToCart } = useWishlist();
  const [isRemoving, setIsRemoving] = useState(false);
  const [isMoving, setIsMoving] = useState(false);

  async function handleRemove() {
    setIsRemoving(true);
    await removeItem(item.id);
    setIsRemoving(false);
  }

  async function handleMoveToCart() {
    setIsMoving(true);
    await moveToCart(item.id);
    setIsMoving(false);
  }

  return (
    <div className="cart-line" style={{ gridTemplateColumns: '56px 1fr auto auto' }}>
      <div className="cart-line__media">
        {item.image ? <img src={item.image} alt={item.productName} /> : <span className="card__media--empty">No image</span>}
      </div>
      <div className="cart-line__details">
        <Link href={`/products/${item.productSlug}`} className="cart-line__name">
          {item.productName}
        </Link>
        {item.variantSku && <div className="cart-line__variant">{item.variantSku}</div>}
        {!item.isAvailable && (
          <div className="badge badge--out-of-stock" style={{ marginTop: 4 }}>
            No longer available
          </div>
        )}
      </div>
      <strong>{formatPrice(item.price)}</strong>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          type="button"
          className="btn"
          disabled={!item.isAvailable || isMoving}
          onClick={() => void handleMoveToCart()}
          style={{ padding: '6px 12px', fontSize: '0.85rem' }}
        >
          {isMoving ? 'Moving…' : 'Move to Cart'}
        </button>
        <button
          type="button"
          className="btn btn--outline"
          disabled={isRemoving}
          onClick={() => void handleRemove()}
          style={{ padding: '6px 12px', fontSize: '0.85rem' }}
        >
          {isRemoving ? 'Removing…' : 'Remove'}
        </button>
      </div>
    </div>
  );
}

export default function WishlistPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { wishlist, isLoading } = useWishlist();

  if (authLoading || isLoading) {
    return (
      <main className="container">
        <h1>Your Wishlist</h1>
        <div className="empty-state">Loading…</div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="container">
        <h1>Your Wishlist</h1>
        <div className="empty-state">
          <p>Sign in to view and manage your wishlist.</p>
          <Link href="/login" className="btn">
            Sign In
          </Link>
        </div>
      </main>
    );
  }

  const items = wishlist?.items ?? [];

  if (items.length === 0) {
    return (
      <main className="container">
        <h1>Your Wishlist</h1>
        <div className="empty-state">
          <p>Your wishlist is empty.</p>
          <Link href="/products" className="btn">
            Continue Shopping
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <h1>Your Wishlist</h1>
      <div className="cart-lines">
        {items.map((item) => (
          <WishlistRow key={item.id} item={item} />
        ))}
      </div>
    </main>
  );
}
