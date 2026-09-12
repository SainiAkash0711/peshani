'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { CartResponse } from '../types/cart';
import { useToast } from './toast-context';

interface CartContextValue {
  cart: CartResponse | null;
  isLoading: boolean;
  error: string | null;
  addItem: (productId: string, variantId: string | undefined, quantity: number) => Promise<boolean>;
  updateItem: (itemId: string, quantity: number) => Promise<boolean>;
  removeItem: (itemId: string) => Promise<void>;
  clear: () => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data.message ?? 'Something went wrong. Please try again.';
  } catch {
    return 'Something went wrong. Please try again.';
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { show } = useToast();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cart', { cache: 'no-store' });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      setCart(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addItem = useCallback(
    async (productId: string, variantId: string | undefined, quantity: number) => {
      try {
        const res = await fetch('/api/cart/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId, variantId, quantity }),
        });
        if (!res.ok) {
          show(await extractErrorMessage(res), 'error');
          return false;
        }
        setCart(await res.json());
        show('Added to cart');
        return true;
      } catch {
        show('Could not reach the cart service. Please try again.', 'error');
        return false;
      }
    },
    [show],
  );

  const updateItem = useCallback(
    async (itemId: string, quantity: number) => {
      try {
        const res = await fetch(`/api/cart/items/${itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity }),
        });
        if (!res.ok) {
          show(await extractErrorMessage(res), 'error');
          return false;
        }
        setCart(await res.json());
        return true;
      } catch {
        show('Could not reach the cart service. Please try again.', 'error');
        return false;
      }
    },
    [show],
  );

  const removeItem = useCallback(async (itemId: string) => {
    const res = await fetch(`/api/cart/items/${itemId}`, { method: 'DELETE' });
    if (res.ok) setCart(await res.json());
  }, []);

  const clear = useCallback(async () => {
    const res = await fetch('/api/cart', { method: 'DELETE' });
    if (res.ok) setCart(await res.json());
  }, []);

  return (
    <CartContext.Provider value={{ cart, isLoading, error, addItem, updateItem, removeItem, clear, refresh }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
