'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCart } from './cart-context';
import { useWishlist } from './wishlist-context';
import { useToast } from './toast-context';
import type { CartMergeResult } from '../types/cart';

interface AuthUser {
  email: string;
  firstName?: string;
  lastName?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, firstName?: string, lastName?: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function describeMerge(merge: CartMergeResult): string {
  const parts: string[] = [];
  if (merge.merged.length) parts.push(`${merge.merged.length} item(s) carried over from your cart`);
  if (merge.quantityAdjusted.length) parts.push(`${merge.quantityAdjusted.length} adjusted for stock`);
  if (merge.removed.length) parts.push(`${merge.removed.length} no longer available`);
  return parts.length ? parts.join(', ') : 'Your cart is ready';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const { refresh: refreshCart } = useCart();
  const { refresh: refreshWishlist } = useWishlist();
  const { show } = useToast();

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        show(data.message ?? 'Invalid email or password', 'error');
        return false;
      }
      setUser({ email });
      await refreshCart();
      await refreshWishlist();
      if (data.cartMerge) show(describeMerge(data.cartMerge));
      router.push('/');
      return true;
    },
    [refreshCart, refreshWishlist, router, show],
  );

  const register = useCallback(
    async (email: string, password: string, firstName?: string, lastName?: string) => {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, firstName, lastName }),
      });
      const data = await res.json();
      if (!res.ok) {
        show(data.message ?? 'Could not create an account', 'error');
        return false;
      }
      show('Account created - please sign in');
      router.push('/login');
      return true;
    },
    [router, show],
  );

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    await refreshCart();
    await refreshWishlist();
    router.push('/');
  }, [refreshCart, refreshWishlist, router]);

  return <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
