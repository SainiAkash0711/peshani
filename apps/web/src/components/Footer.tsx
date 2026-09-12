import { getStoreSettings } from '../lib/api';

export async function Footer() {
  const settings = await getStoreSettings();

  return (
    <footer className="site-footer">
      <div className="container site-footer__grid">
        <div>
          <strong style={{ color: 'var(--color-text)' }}>{settings.storeName}</strong>
          <p>{settings.storeDescription}</p>
        </div>
        <div>
          {settings.supportEmail && <div>{settings.supportEmail}</div>}
          {settings.supportPhone && <div>{settings.supportPhone}</div>}
        </div>
        <div>&copy; {new Date().getFullYear()} {settings.storeName}. All rights reserved.</div>
      </div>
    </footer>
  );
}
