import { ReactNode } from 'react';
import { Logo } from '../Logo';
import './auth.css';

const BENEFITS = [
  {
    title: 'Orders & returns',
    text: 'Process, ship and refund from one place.',
    icon: 'M3 7h11v9H3V7Zm11 3h4l3 3v3h-7v-6ZM7 19a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm10 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z',
  },
  {
    title: 'Catalog & inventory',
    text: 'Keep products, prices and stock up to date.',
    icon: 'M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Zm0 0 8 4.5m0 0 8-4.5M12 12v9',
  },
  {
    title: 'Insights & messages',
    text: 'Track sales and reply to customers quickly.',
    icon: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  },
];

interface AuthShellProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  shake?: boolean;
  children: ReactNode;
}

export function AuthShell({ eyebrow, title, subtitle, shake = false, children }: AuthShellProps) {
  return (
    <main className="auth-page">
      <div className={`auth-card${shake ? ' is-shaking' : ''}`}>
        <aside className="auth-brand" aria-hidden="true">
          <span className="auth-brand__blob auth-brand__blob--one" />
          <span className="auth-brand__blob auth-brand__blob--two" />
          <div className="auth-brand__logo">
            <Logo size={34} />
            <span className="auth-brand__logo-text">Peshani</span>
            <span className="auth-brand__badge">Admin</span>
          </div>
          <h2 className="auth-brand__heading">Run your natural &amp; handmade store with ease.</h2>
          <ul className="auth-benefits">
            {BENEFITS.map((benefit) => (
              <li key={benefit.title}>
                <span className="auth-benefits__icon">
                  <svg viewBox="0 0 24 24" width="20" height="20">
                    <path d={benefit.icon} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span>
                  <strong>{benefit.title}</strong>
                  <small>{benefit.text}</small>
                </span>
              </li>
            ))}
          </ul>
          <p className="auth-brand__trust">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Zm-1.2 12.6L7.6 12.4l1.4-1.4 1.8 1.8 4.2-4.2 1.4 1.4-5.6 5.6Z" fill="currentColor" />
            </svg>
            Restricted area — authorised staff only.
          </p>
        </aside>

        <section className="auth-panel">
          <p className="auth-eyebrow">{eyebrow}</p>
          <h1 className="auth-title">{title}</h1>
          <p className="auth-subtitle">{subtitle}</p>
          {children}
        </section>
      </div>
    </main>
  );
}
