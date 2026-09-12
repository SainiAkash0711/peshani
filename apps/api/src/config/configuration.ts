export function parseTrustProxy(raw: string | undefined): boolean | number | string {
  if (!raw || raw === 'false') return false;
  if (raw === 'true') return true;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return raw; // an IP/CIDR or comma-separated list - passed through to Express as-is.
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  corsOrigins: string[];
  databaseUrl: string;
  server: {
    // Express's `trust proxy` setting - `false` (default, safe when the API
    // is reachable directly) never trusts X-Forwarded-*; `true` trusts the
    // immediate hop unconditionally (only correct if exactly one trusted
    // reverse proxy sits directly in front, e.g. this container's own nginx
    // sidecar); a numeric string trusts that many hops from the client; any
    // other string is passed through to Express as-is (it natively accepts
    // an IP/CIDR or comma-separated list of trusted proxy addresses - the
    // recommended production form, scoped to the actual proxy's address
    // rather than blanket-trusting every hop).
    trustProxy: boolean | number | string;
    // How long a SIGTERM/SIGINT handler waits for in-flight requests/work to
    // finish before force-exiting - see main.ts's shutdown handler.
    shutdownTimeoutMs: number;
  };
  workers: {
    // Lets ops run exactly one designated instance with workers enabled in
    // a future multi-instance deployment (§14) without touching code - every
    // other instance sets this to false so the outbox/email pollers never
    // duplicate work. Defaults true (correct for today's single-instance
    // deployment, where duplication isn't a risk since only one process
    // exists).
    enabled: boolean;
  };
  jwt: {
    accessSecret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
  };
  defaultStore: {
    name: string;
    currency: string;
    timezone: string;
  };
  catalog: {
    maxVariantCombinations: number;
  };
  cart: {
    maxItemQuantity: number;
    guestCartExpiryDays: number;
    userCartExpiryDays: number;
  };
  storage: {
    provider: 'local' | 's3';
    localRoot: string;
    publicBaseUrl: string;
    // Reserved for a future S3-compatible provider - not read by anything
    // yet, but defined here so switching STORAGE_PROVIDER=s3 later doesn't
    // require another round of config plumbing.
    s3: {
      bucket?: string;
      region?: string;
      endpoint?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      signedUrlExpirySeconds: number;
    };
  };
  media: {
    maxUploadBytes: number;
    allowedMimeTypes: string[];
  };
  razorpay: {
    keyId: string;
    keySecret: string;
    webhookSecret: string;
    mode: 'test' | 'live';
  };
  checkout: {
    reservationTtlMinutes: number;
  };
  email: {
    enabled: boolean;
    host?: string;
    port: number;
    username?: string;
    password?: string;
    from: string;
    fromName: string;
    secure: boolean;
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.API_PORT ?? '4000', 10),
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  databaseUrl: process.env.DATABASE_URL ?? '',
  server: {
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    shutdownTimeoutMs: parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? '10000', 10),
  },
  workers: {
    enabled: process.env.ENABLE_WORKERS !== 'false',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },
  defaultStore: {
    name: process.env.DEFAULT_STORE_NAME ?? 'Peshani',
    currency: process.env.DEFAULT_STORE_CURRENCY ?? 'INR',
    timezone: process.env.DEFAULT_STORE_TIMEZONE ?? 'Asia/Kolkata',
  },
  catalog: {
    maxVariantCombinations: parseInt(process.env.MAX_VARIANT_COMBINATIONS ?? '200', 10),
  },
  cart: {
    maxItemQuantity: parseInt(process.env.MAX_CART_ITEM_QUANTITY ?? '100', 10),
    guestCartExpiryDays: parseInt(process.env.GUEST_CART_EXPIRY_DAYS ?? '30', 10),
    userCartExpiryDays: parseInt(process.env.USER_CART_EXPIRY_DAYS ?? '90', 10),
  },
  storage: {
    provider: process.env.STORAGE_PROVIDER === 's3' ? 's3' : 'local',
    localRoot: process.env.STORAGE_LOCAL_ROOT ?? './storage',
    publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? '4000'}`,
    s3: {
      bucket: process.env.STORAGE_S3_BUCKET,
      region: process.env.STORAGE_S3_REGION,
      endpoint: process.env.STORAGE_S3_ENDPOINT,
      accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY,
      signedUrlExpirySeconds: parseInt(process.env.STORAGE_S3_SIGNED_URL_EXPIRY_SECONDS ?? '3600', 10),
    },
  },
  media: {
    maxUploadBytes: parseInt(process.env.MEDIA_MAX_UPLOAD_BYTES ?? String(10 * 1024 * 1024), 10),
    allowedMimeTypes: (process.env.MEDIA_ALLOWED_MIME_TYPES ?? 'image/jpeg,image/png,image/webp')
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean),
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
    mode: process.env.RAZORPAY_MODE === 'live' ? 'live' : 'test',
  },
  checkout: {
    reservationTtlMinutes: parseInt(process.env.CHECKOUT_RESERVATION_TTL_MINUTES ?? '15', 10),
  },
  email: {
    // Never crashes the app when unset (§10) - NotificationsModule falls
    // back to a logging-only EmailProvider whenever this is false or no
    // host is configured, so dev/test environments work without SMTP.
    enabled: process.env.EMAIL_ENABLED === 'true',
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT ?? '587', 10),
    username: process.env.EMAIL_USERNAME,
    password: process.env.EMAIL_PASSWORD,
    from: process.env.EMAIL_FROM ?? 'no-reply@peshani.example',
    fromName: process.env.EMAIL_FROM_NAME ?? 'Peshani',
    secure: process.env.EMAIL_SECURE === 'true',
  },
});
