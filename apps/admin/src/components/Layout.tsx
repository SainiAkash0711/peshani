import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { Logo } from './Logo';

const NAV_ITEMS: { to: string; label: string; permission?: string }[] = [
  { to: '/store-settings', label: 'Store Settings', permission: 'settings.store.manage' },
  { to: '/analytics', label: 'Analytics', permission: 'analytics.read' },
  { to: '/homepage-slides', label: 'Homepage Slider', permission: 'homepage_slides.manage' },
  { to: '/blog', label: 'Blog', permission: 'blog.manage' },
  { to: '/products', label: 'Products' },
  { to: '/categories', label: 'Categories' },
  { to: '/subcategories', label: 'Subcategories' },
  { to: '/brands', label: 'Brands' },
  { to: '/attributes', label: 'Attributes' },
  { to: '/warehouses', label: 'Warehouses' },
  { to: '/inventory', label: 'Inventory' },
  { to: '/shipping-methods', label: 'Shipping Methods' },
  { to: '/orders', label: 'Orders' },
  { to: '/returns', label: 'Returns', permission: 'return.read' },
  { to: '/promotions', label: 'Promotions' },
  { to: '/coupons', label: 'Coupons' },
  { to: '/reviews', label: 'Reviews' },
  { to: '/notifications', label: 'Notifications', permission: 'notification.read' },
  { to: '/notification-templates', label: 'Notification Templates', permission: 'notification_template.read' },
];

export function Layout() {
  const { user, logout, hasPermission } = useAuth();
  const visibleNavItems = NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission));

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <aside style={{ width: 220, background: '#111827', color: '#e5e7eb', padding: '20px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px 20px' }}>
          <Logo size={30} />
          <span style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>Peshani Admin</span>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column' }}>
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                padding: '10px 20px',
                color: isActive ? '#fff' : '#9ca3af',
                background: isActive ? '#1f2937' : 'transparent',
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                borderLeft: isActive ? '3px solid #4f46e5' : '3px solid transparent',
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 14,
            padding: '14px 24px',
            borderBottom: '1px solid #e5e7eb',
            background: '#fff',
          }}
        >
          <span style={{ fontSize: 13, color: '#6b7280' }}>{user?.email}</span>
          <button
            onClick={() => void logout()}
            style={{
              border: '1px solid #d1d5db',
              background: '#fff',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </header>
        <main style={{ flex: 1, padding: 24, background: '#f9fafb' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
