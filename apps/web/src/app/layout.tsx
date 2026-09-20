import type { ReactNode } from 'react';
import { Playfair_Display } from 'next/font/google';
import './globals.css';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { Providers } from '../components/Providers';
import { WhatsAppButton } from '../components/WhatsAppButton';
import { ContactFormButton } from '../components/ContactFormButton';
import { getStoreSettings } from '../lib/api';
import { SITE_URL } from '../lib/site';
import { safeJsonLd } from '../lib/json-ld';

// A distinctive serif for section headings only ("Featured Products", "Shop
// by Category", etc.) - everything else keeps the existing system-font
// stack. next/font self-hosts the font at build time (no runtime request to
// Google, no CLS/CSP concerns), and exposes it as a CSS variable so
// globals.css can opt individual selectors in rather than changing the
// site's base typography.
const headingFont = Playfair_Display({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-heading', display: 'swap' });

export async function generateMetadata() {
  const settings = await getStoreSettings();
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: settings.storeName, template: `%s | ${settings.storeName}` },
    description: settings.storeDescription ?? 'Your trusted online shopping destination',
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const settings = await getStoreSettings();

  const contactPoint: Record<string, string> = {};
  if (settings.supportEmail) contactPoint.email = settings.supportEmail;
  if (settings.supportPhone) contactPoint.telephone = settings.supportPhone;

  const organizationJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: settings.storeName,
    url: SITE_URL,
  };
  if (settings.storeDescription) organizationJsonLd.description = settings.storeDescription;
  if (Object.keys(contactPoint).length > 0) {
    organizationJsonLd.contactPoint = { '@type': 'ContactPoint', ...contactPoint };
  }

  const websiteJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: settings.storeName,
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };

  return (
    <html lang="en" className={headingFont.variable}>
      <body>
        <Providers>
          <Header />
          {children}
          <Footer />
          <div className="fab-stack">
            <ContactFormButton />
            <WhatsAppButton phone={settings.supportPhone} />
          </div>
        </Providers>
        {/* eslint-disable-next-line react/no-danger */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(organizationJsonLd) }} />
        {/* eslint-disable-next-line react/no-danger */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(websiteJsonLd) }} />
      </body>
    </html>
  );
}
