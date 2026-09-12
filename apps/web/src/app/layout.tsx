import type { ReactNode } from 'react';
import './globals.css';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { Providers } from '../components/Providers';
import { getStoreSettings } from '../lib/api';
import { SITE_URL } from '../lib/site';
import { safeJsonLd } from '../lib/json-ld';

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
    <html lang="en">
      <body>
        <Providers>
          <Header />
          {children}
          <Footer />
        </Providers>
        {/* eslint-disable-next-line react/no-danger */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(organizationJsonLd) }} />
        {/* eslint-disable-next-line react/no-danger */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(websiteJsonLd) }} />
      </body>
    </html>
  );
}
