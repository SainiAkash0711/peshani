'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * The mobile hamburger menu (Header.tsx) is a pure CSS checkbox toggle -
 * deliberately no client JS, so Header can stay an async Server Component.
 * That means it has no way to know a navigation happened and can't close
 * itself when a nav link is tapped - a Next.js <Link> is a client-side route
 * change, not a full page reload, so the checkbox's checked state (part of
 * the DOM, untouched by the route change) just stays open across it.
 *
 * This tiny client component is the minimal fix: it renders nothing, but
 * re-runs on every pathname change and force-unchecks the toggle, closing
 * the dropdown - without turning Header itself into a client component.
 */
export function MobileNavAutoClose() {
  const pathname = usePathname();

  useEffect(() => {
    const checkbox = document.getElementById('site-nav-toggle') as HTMLInputElement | null;
    if (checkbox) checkbox.checked = false;
  }, [pathname]);

  return null;
}
