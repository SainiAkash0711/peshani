import { ReactNode } from 'react';
import { Logo } from '../Logo';
import './auth.css';

const BENEFITS = [
  {
    title: 'Track every order',
    text: 'Follow your parcels from our makers to your door.',
    icon: 'M3 7h11v9H3V7Zm11 3h4l3 3v3h-7v-6ZM7 19a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm10 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z',
  },
  {
    title: 'Save your favourites',
    text: 'Keep a wishlist of handmade pieces you love.',
    icon: 'M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 10c0 5.65-7 10-7 10Z',
  },
  {
    title: 'Faster, secure checkout',
    text: 'Your details are saved safely for next time.',
    icon: 'M6 10V8a6 6 0 1 1 12 0v2h1v11H5V10h1Zm2 0h8V8a4 4 0 1 0-8 0v2Z',
  },
];

interface AuthShellProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  brandHeading?: string;
  shake?: boolean;
  children: ReactNode;
}

export function AuthShell({
  eyebrow,
  title,
  subtitle,
  brandHeading = 'Natural. Handmade. Delivered with care.',
  shake = false,
  children,
}: AuthShellProps) {
  return (
    <main className="auth-page">
      <div className={`auth-card${shake ? ' is-shaking' : ''}`}>
        <aside className="auth-brand" aria-hidden="true">
          <span className="auth-brand__blob auth-brand__blob--one" />
          <span className="auth-brand__blob auth-brand__blob--two" />
          <div className="auth-brand__logo">
            <Logo name="Peshani" />
          </div>
          <h2 className="auth-brand__heading">{brandHeading}</h2>
          <ul className="auth-benefits">
            {BENEFITS.map((benefit) => (
              <li key={benefit.title}>
                <span className="auth-benefits__icon">
                  <svg viewBox="0 0 24 24" width="20" height="20">
                    <path d={benefit.icon} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
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
            Your information is encrypted and never shared.
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
