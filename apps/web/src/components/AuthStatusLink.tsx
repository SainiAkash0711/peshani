'use client';

import Link from 'next/link';
import { useAuth } from '../lib/auth-context';

export function AuthStatusLink() {
  const { user, isLoading, logout } = useAuth();

  if (isLoading) return null;

  if (!user) {
    return (
      <>
        <Link href="/login" className="site-header__auth-btn site-header__auth-btn--outline">
          Sign In
        </Link>
        <Link href="/register" className="site-header__auth-btn site-header__auth-btn--solid">
          Sign Up
        </Link>
      </>
    );
  }

  return (
    <div className="profile-menu">
      <button type="button" className="profile-menu__trigger" aria-haspopup="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
        </svg>
        Profile
      </button>
      <div className="profile-menu__dropdown" role="menu">
        <div className="profile-menu__name">{user.email}</div>
        <Link href="/account/profile" role="menuitem">
          My Profile
        </Link>
        <Link href="/orders" role="menuitem">
          Your Orders
        </Link>
        <Link href="/returns" role="menuitem">
          My Returns
        </Link>
        <Link href="/account/notification-preferences" role="menuitem">
          Notification Preferences
        </Link>
        <button type="button" role="menuitem" onClick={() => void logout()}>
          Sign Out
        </button>
      </div>
    </div>
  );
}
