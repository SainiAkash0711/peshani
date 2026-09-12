'use client';

import { useState, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';
import { useWishlist } from '../lib/wishlist-context';
import { useToast } from '../lib/toast-context';

interface WishlistButtonProps {
  productId: string;
  variantId?: string | null;
  className?: string;
}

export function WishlistButton({ productId, variantId, className }: WishlistButtonProps) {
  const { user } = useAuth();
  const { findItem, addItem, removeItem } = useWishlist();
  const { show } = useToast();
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);

  const existing = findItem(productId, variantId ?? null);
  const isSaved = Boolean(existing);

  async function handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (!user) {
      show('Please sign in to save items to your wishlist', 'error');
      router.push('/login');
      return;
    }

    setIsBusy(true);
    if (isSaved && existing) {
      await removeItem(existing.id);
    } else {
      await addItem(productId, variantId ?? undefined);
    }
    setIsBusy(false);
  }

  return (
    <button
      type="button"
      onClick={(e) => void handleClick(e)}
      disabled={isBusy}
      aria-label={isSaved ? 'Remove from wishlist' : 'Add to wishlist'}
      aria-pressed={isSaved}
      className={className}
      style={{
        border: 'none',
        background: 'none',
        cursor: isBusy ? 'wait' : 'pointer',
        fontSize: '1.2rem',
        lineHeight: 1,
        color: isSaved ? '#dc2626' : 'var(--color-text-muted, #6b7280)',
        padding: 4,
      }}
    >
      {isSaved ? '♥' : '♡'}
    </button>
  );
}
