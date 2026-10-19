import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { useAuth } from '../../lib/auth-context';
import { formatMoney, formatNumber } from '../../lib/analytics-format';
import { InventoryResponse, OverviewResponse } from '../../types/analytics';
import { PaginatedResult } from '../../types/catalog';
import { OrderListItem, OrderStatus } from '../../types/orders';
import { OrderStatusBadge } from '../orders/badges';
import './dashboard.css';

interface ContactMessageRow {
  id: string;
  name: string;
  email: string;
  message: string;
  createdAt: string;
  replyCount: number;
}

const PIPELINE: { status: OrderStatus; label: string }[] = [
  { status: 'PENDING_PAYMENT', label: 'Awaiting payment' },
  { status: 'CONFIRMED', label: 'Confirmed' },
  { status: 'PROCESSING', label: 'Processing' },
  { status: 'PACKED', label: 'Packed' },
  { status: 'SHIPPED', label: 'Shipped' },
  { status: 'DELIVERED', label: 'Delivered' },
];

const QUICK_ACTIONS = [
  { to: '/products/new', label: 'Add a product', icon: 'M12 5v14M5 12h14' },
  { to: '/orders', label: 'Manage orders', icon: 'M6 7h12l-1 13H7L6 7Zm3 0V6a3 3 0 0 1 6 0v1' },
  { to: '/inventory', label: 'Update stock', icon: 'M3 9l9-5 9 5v10H3V9Zm6 10v-6h6v6' },
  { to: '/homepage-slides', label: 'Edit homepage', icon: 'M4 5h16v12H4V5Zm4 16h8' },
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function Kpi({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon: string }) {
  return (
    <div className="dash-kpi">
      <span className="dash-kpi__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d={icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="dash-kpi__label">{label}</span>
      <span className="dash-kpi__value">{value}</span>
      {hint && <span className="dash-kpi__hint">{hint}</span>}
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: { to: string; label: string }; children: React.ReactNode }) {
  return (
    <section className="dash-panel">
      <header className="dash-panel__head">
        <h2>{title}</h2>
        {action && (
          <Link to={action.to} className="dash-panel__action">
            {action.label} →
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const canAnalytics = hasPermission('analytics.read');
  const canOrders = hasPermission('order.read');
  const canMessages = hasPermission('contact_message.read');

  const overview = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: () => apiClient.get<OverviewResponse>('/admin/analytics/overview?preset=last30days'),
    enabled: canAnalytics,
  });
  const inventory = useQuery({
    queryKey: ['dashboard', 'inventory'],
    queryFn: () => apiClient.get<InventoryResponse>('/admin/analytics/inventory'),
    enabled: canAnalytics,
  });
  const orders = useQuery({
    queryKey: ['dashboard', 'recent-orders'],
    queryFn: () => apiClient.get<PaginatedResult<OrderListItem>>('/admin/orders?page=1&pageSize=6'),
    enabled: canOrders,
  });
  const messages = useQuery({
    queryKey: ['dashboard', 'messages'],
    queryFn: () => apiClient.get<PaginatedResult<ContactMessageRow>>('/admin/contact-messages?page=1&pageSize=5'),
    enabled: canMessages,
  });

  const name = (user?.email ?? '').split('@')[0];
  const data = overview.data;
  const lowStock = inventory.data?.lowStockProducts.length ?? 0;
  const outOfStock = inventory.data?.outOfStockProducts.length ?? 0;
  const unanswered = messages.data?.items.filter((m) => m.replyCount === 0).length ?? 0;

  const attention = [
    data && data.orders.byStatus.CONFIRMED > 0 && {
      to: '/orders?status=CONFIRMED',
      tone: 'gold',
      text: `${data.orders.byStatus.CONFIRMED} confirmed ${data.orders.byStatus.CONFIRMED === 1 ? 'order is' : 'orders are'} waiting to be processed`,
    },
    outOfStock > 0 && {
      to: '/inventory',
      tone: 'red',
      text: `${outOfStock} ${outOfStock === 1 ? 'product is' : 'products are'} out of stock`,
    },
    lowStock > 0 && {
      to: '/inventory',
      tone: 'gold',
      text: `${lowStock} ${lowStock === 1 ? 'item is' : 'items are'} running low on stock`,
    },
    unanswered > 0 && {
      to: '/contact-messages',
      tone: 'blue',
      text: `${unanswered} recent customer ${unanswered === 1 ? 'message has' : 'messages have'} no reply yet`,
    },
  ].filter(Boolean) as { to: string; tone: string; text: string }[];

  return (
    <div className="dash">
      <section className="dash-hero">
        <div>
          <p className="dash-hero__eyebrow">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1>
            {greeting()}
            {name ? `, ${name}` : ''}
          </h1>
          <p className="dash-hero__sub">Here&apos;s what&apos;s happening in your store.</p>
        </div>
        <div className="dash-hero__actions">
          {QUICK_ACTIONS.map((action) => (
            <Link key={action.to} to={action.to} className="dash-quick">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d={action.icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {action.label}
            </Link>
          ))}
        </div>
      </section>

      {canAnalytics && (
        <>
          <div className="dash-section-head">
            <h2>Last 30 days</h2>
            <Link to="/analytics">Full analytics →</Link>
          </div>
          <div className="dash-kpis">
            {overview.isLoading ? (
              [0, 1, 2, 3].map((i) => <div key={i} className="dash-kpi dash-kpi--loading" />)
            ) : overview.isError || !data ? (
              <p className="dash-muted">Couldn&apos;t load sales figures right now.</p>
            ) : (
              <>
                <Kpi label="Net sales" value={formatMoney(data.sales.netSales)} hint={`${formatMoney(data.sales.grossSales)} gross`} icon="M4 17l5-5 4 4 7-8M15 8h5v5" />
                <Kpi label="Orders" value={formatNumber(data.orders.total)} hint={`${formatNumber(data.orders.delivered)} delivered`} icon="M6 7h12l-1 13H7L6 7Zm3 0V6a3 3 0 0 1 6 0v1" />
                <Kpi label="Average order" value={formatMoney(data.averageOrderValue)} icon="M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6" />
                <Kpi label="New customers" value={formatNumber(data.customers.newCustomers)} hint={`${formatNumber(data.customers.totalCustomers)} total`} icon="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.3 3.1-6 7-6s7 2.7 7 6" />
              </>
            )}
          </div>

          {data && (
            <div className="dash-pipeline" aria-label="Orders by status">
              {PIPELINE.map((step) => (
                <button
                  key={step.status}
                  type="button"
                  className="dash-pipeline__step"
                  onClick={() => navigate(`/orders?status=${step.status}`)}
                >
                  <span className="dash-pipeline__count">{formatNumber(data.orders.byStatus[step.status] ?? 0)}</span>
                  <span className="dash-pipeline__label">{step.label}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div className="dash-grid">
        {canOrders && (
          <Panel title="Recent orders" action={{ to: '/orders', label: 'All orders' }}>
            {orders.isLoading ? (
              <p className="dash-muted">Loading…</p>
            ) : !orders.data || orders.data.items.length === 0 ? (
              <div className="dash-empty">
                <p>No orders yet. They&apos;ll show up here as soon as customers check out.</p>
              </div>
            ) : (
              <ul className="dash-list">
                {orders.data.items.map((order) => (
                  <li key={order.orderNumber}>
                    <Link to={`/orders/${order.orderNumber}`} className="dash-list__row">
                      <span className="dash-list__main">
                        <strong>#{order.orderNumber}</strong>
                        <small>
                          {order.customerEmail} · {timeAgo(order.createdAt)}
                        </small>
                      </span>
                      <OrderStatusBadge status={order.status} />
                      <span className="dash-list__amount">{formatMoney(Number(order.totalAmount))}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        <div className="dash-side">
          <Panel title="Needs attention">
            {attention.length === 0 ? (
              <div className="dash-allgood">
                <span aria-hidden="true">✓</span>
                <p>You&apos;re all caught up. Nothing needs your attention right now.</p>
              </div>
            ) : (
              <ul className="dash-attention">
                {attention.map((item) => (
                  <li key={item.text}>
                    <Link to={item.to} className={`dash-attention__item dash-attention__item--${item.tone}`}>
                      <span className="dash-attention__dot" aria-hidden="true" />
                      {item.text}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {canMessages && (
            <Panel title="Latest messages" action={{ to: '/contact-messages', label: 'Inbox' }}>
              {!messages.data || messages.data.items.length === 0 ? (
                <p className="dash-muted">No customer messages yet.</p>
              ) : (
                <ul className="dash-list">
                  {messages.data.items.slice(0, 4).map((message) => (
                    <li key={message.id}>
                      <Link to={`/contact-messages/${message.id}`} className="dash-list__row">
                        <span className="dash-avatar" aria-hidden="true">
                          {message.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="dash-list__main">
                          <strong>{message.name}</strong>
                          <small>{message.message}</small>
                        </span>
                        {message.replyCount === 0 && <span className="dash-new">New</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
