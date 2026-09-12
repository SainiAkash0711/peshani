'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { WishlistResponse, WishlistItemDetail } from '../types/wishlist';
import { useToast } from './toast-context';

interface WishlistContextValue {
  wishlist: WishlistResponse | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  findItem: (productId: string, variantId?: string | null) => WishlistItemDetail | undefined;
  addItem: (productId: string, variantId?: string) => Promise<boolean>;
  removeItem: (itemId: string) => Promise<boolean>;
  moveToCart: (itemId: string, quantity?: number) => Promise<boolean>;
}

const WishlistContext = createContext<WishlistContextValue | null>(null);

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data.message ?? 'Something went wrong. Please try again.';
  } catch {
    return 'Something went wrong. Please try again.';
  }
}

export function WishlistProvider({ children }: { children: ReactNode }) {
  const [wishlist, setWishlist] = useState<WishlistResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { show } = useToast();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/wishlist', { cache: 'no-store' });
      if (!res.ok) {
        // Not signed in (or no wishlist yet) - treat as an empty wishlist, no error noise.
        setWishlist(null);
        return;
      }
      setWishlist(await res.json());
    } catch {
      setWishlist(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const findItem = useCallback(
    (productId: string, variantId?: string | null) =>
      wishlist?.items.find((item) => item.productId === productId && (item.variantId ?? null) === (variantId ?? null)),
    [wishlist],
  );

  const addItem = useCallback(
    async (productId: string, variantId?: string) => {
      try {
        const res = await fetch('/api/wishlist/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId, variantId }),
        });
        if (!res.ok) {
          show(await extractErrorMessage(res), 'error');
          return false;
        }
        await refresh();
        show('Added to wishlist');
        return true;
      } catch {
        show('Could not reach the wishlist service. Please try again.', 'error');
        return false;
      }
    },
    [refresh, show],
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      try {
        const res = await fetch(`/api/wishlist/items/${itemId}`, { method: 'DELETE' });
        if (!res.ok) {
          show(await extractErrorMessage(res), 'error');
          return false;
        }
        await refresh();
        return true;
      } catch {
        show('Could not reach the wishlist service. Please try again.', 'error');
        return false;
      }
    },
    [refresh, show],
  );

  const moveToCart = useCallback(
    async (itemId: string, quantity?: number) => {
      try {
        const res = await fetch(`/api/wishlist/items/${itemId}/move-to-cart`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(quantity ? { quantity } : {}),
        });
        if (!res.ok) {
          show(await extractErrorMessage(res), 'error');
          return false;
        }
        await refresh();
        show('Moved to cart');
        return true;
      } catch {
        show('Could not reach the cart service. Please try again.', 'error');
        return false;
      }
    },
    [refresh, show],
  );

  const value = useMemo(
    () => ({ wishlist, isLoading, refresh, findItem, addItem, removeItem, moveToCart }),
    [wishlist, isLoading, refresh, findItem, addItem, removeItem, moveToCart],
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist(): WishlistContextValue {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error('useWishlist must be used within WishlistProvider');
  return ctx;
}
