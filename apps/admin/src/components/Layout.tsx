import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { Logo } from './Logo';
import './layout.css';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  permission?: string;
  end?: boolean;
}

const ICONS = {
  dashboard: 'M4 4h7v7H4V4Zm9 0h7v4h-7V4Zm0 6h7v10h-7V10ZM4 13h7v7H4v-7Z',
  analytics: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  orders: 'M6 7h12l-1 13H7L6 7Zm3 0V6a3 3 0 0 1 6 0v1',
  returns: 'M6 8h9a5 5 0 0 1 0 10h-3M6 8l3-3M6 8l3 3',
  promotions: 'M20 12l-8 8-9-9V3h8l9 9ZM7.5 7.5h.01',
  coupons: 'M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4V7Zm9 0v10',
  reviews: 'm12 3 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8L3.5 9.2l5.9-.8L12 3Z',
  products: 'M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Zm0 0 8 4.5m0 0 8-4.5M12 12v9',
  categories: 'M4 5h6v6H4V5Zm10 0h6v6h-6V5ZM4 15h6v4H4v-4Zm10 0h6v4h-6v-4Z',
  subcategories: 'M5 4v12a2 2 0 0 0 2 2h12M9 8h11M9 13h11',
  brands: 'M4 12 12 4h8v8l-8 8-8-8Zm11-4h.01',
  attributes: 'M4 6h10M4 12h16M4 18h7M17 4v4M20 16v4',
  inventory: 'M3 9l9-5 9 5v10H3V9Zm6 10v-6h6v6',
  warehouses: 'M3 21V8l9-5 9 5v13M7 21v-8h10v8M7 17h10',
  shipping: 'M3 7h11v9H3V7Zm11 3h4l3 3v3h-7v-6ZM7 19a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm10 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z',
  slider: 'M4 5h16v12H4V5Zm4 16h8M7 13l3-3 3 3 2-2 2 2',
  blog: 'M5 4h10l4 4v12H5V4Zm3 7h8m-8 4h8m-8-8h4',
  messages: 'M4 5h16v11H8l-4 4V5Zm4 5h8',
  notifications: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4h4',
  templates: 'M4 4h16v16H4V4Zm0 5h16M9 9v11',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
};

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: ICONS.dashboard, end: true },
      { to: '/analytics', label: 'Analytics', icon: ICONS.analytics, permission: 'analytics.read' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { to: '/orders', label: 'Orders', icon: ICONS.orders },
      { to: '/returns', label: 'Returns', icon: ICONS.returns, permission: 'return.read' },
      { to: '/promotions', label: 'Promotions', icon: ICONS.promotions },
      { to: '/coupons', label: 'Coupons', icon: ICONS.coupons },
      { to: '/reviews', label: 'Reviews', icon: ICONS.reviews },
    ],
  },
  {
    title: 'Catalog',
    items: [
      { to: '/products', label: 'Products', icon: ICONS.products },
      { to: '/categories', label: 'Categories', icon: ICONS.categories },
      { to: '/subcategories', label: 'Subcategories', icon: ICONS.subcategories },
      { to: '/brands', label: 'Brands', icon: ICONS.brands },
      { to: '/attributes', label: 'Attributes', icon: ICONS.attributes },
    ],
  },
  {
    title: 'Stock & delivery',
    items: [
      { to: '/inventory', label: 'Inventory', icon: ICONS.inventory },
      { to: '/warehouses', label: 'Warehouses', icon: ICONS.warehouses },
      { to: '/shipping-methods', label: 'Shipping Methods', icon: ICONS.shipping },
    ],
  },
  {
    title: 'Content',
    items: [
      { to: '/homepage-slides', label: 'Homepage Slider', icon: ICONS.slider, permission: 'homepage_slides.manage' },
      { to: '/blog', label: 'Blog', icon: ICONS.blog, permission: 'blog.manage' },
    ],
  },
  {
    title: 'Customers',
    items: [
      { to: '/contact-messages', label: 'Contact Messages', icon: ICONS.messages, permission: 'contact_message.read' },
      { to: '/notifications', label: 'Notifications', icon: ICONS.notifications, permission: 'notification.read' },
      {
        to: '/notification-templates',
        label: 'Notification Templates',
        icon: ICONS.templates,
        permission: 'notification_template.read',
      },
    ],
  },
  {
    title: 'Settings',
    items: [{ to: '/store-settings', label: 'Store Settings', icon: ICONS.settings, permission: 'settings.store.manage' }],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((group) => group.items.map((item) => ({ ...item, group: group.title })));

function trailFor(pathname: string): { group: string; label: string } {
  if (pathname === '/') return { group: 'Overview', label: 'Dashboard' };
  const match = ALL_ITEMS.filter((item) => item.to !== '/' && pathname.startsWith(item.to)).sort(
    (a, b) => b.to.length - a.to.length,
  )[0];
  return match ? { group: match.group, label: match.label } : { group: 'Peshani', label: 'Admin' };
}

const STOREFRONT_URL = import.meta.env.VITE_STOREFRONT_URL ?? '/';

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Layout() {
  const { user, logout, hasPermission } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || hasPermission(item.permission)),
  })).filter((group) => group.items.length > 0);

  const trail = trailFor(location.pathname);
  const initial = (user?.email ?? '?').charAt(0).toUpperCase();

  return (
    <div className={`admin-shell${menuOpen ? ' is-menu-open' : ''}`}>
      <aside className="admin-sidebar" aria-label="Admin navigation">
        <div className="admin-sidebar__brand">
          <span className="admin-sidebar__logo">
            <Logo size={30} />
          </span>
          <span>
            <strong>Peshani</strong>
            <small>Store admin</small>
          </span>
        </div>
        <nav className="admin-sidebar__nav">
          {groups.map((group) => (
            <div key={group.title} className="admin-sidebar__group">
              <p className="admin-sidebar__group-title">{group.title}</p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `admin-sidebar__link${isActive ? ' is-active' : ''}`}
                >
                  <Icon d={item.icon} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="admin-sidebar__user">
          <span className="admin-avatar" aria-hidden="true">
            {initial}
          </span>
          <span className="admin-sidebar__user-email" title={user?.email}>
            {user?.email}
          </span>
        </div>
      </aside>
      <button type="button" className="admin-backdrop" aria-label="Close menu" onClick={() => setMenuOpen(false)} />

      <div className="admin-main">
        <header className="admin-topbar">
          <button
            type="button"
            className="admin-topbar__menu"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Icon d="M4 7h16M4 12h16M4 17h16" />
          </button>
          <p className="admin-topbar__trail">
            <span>{trail.group}</span>
            <span aria-hidden="true">/</span>
            <strong>{trail.label}</strong>
          </p>
          <div className="admin-topbar__actions">
            <a className="admin-topbar__store" href={STOREFRONT_URL} target="_blank" rel="noopener noreferrer">
              <Icon d="M14 4h6v6m0-6-9 9M18 14v6H4V6h6" />
              <span>View store</span>
            </a>
            <button type="button" className="admin-topbar__signout" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        </header>
        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
