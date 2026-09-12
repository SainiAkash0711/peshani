'use client';

import type { ReactNode } from 'react';
import { ToastProvider } from '../lib/toast-context';
import { CartProvider } from '../lib/cart-context';
import { WishlistProvider } from '../lib/wishlist-context';
import { NotificationProvider } from '../lib/notification-context';
import { AuthProvider } from '../lib/auth-context';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <CartProvider>
        <WishlistProvider>
          <NotificationProvider>
            <AuthProvider>{children}</AuthProvider>
          </NotificationProvider>
        </WishlistProvider>
      </CartProvider>
    </ToastProvider>
  );
}
