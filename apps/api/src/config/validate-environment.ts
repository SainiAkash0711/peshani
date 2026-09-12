// Known local-dev-only placeholder values (see apps/api/.env.example's own
// comments) that must never reach a real production deployment.
const KNOWN_DEV_PLACEHOLDERS = new Set([
  'local_dev_key_secret_do_not_use_in_prod',
  'local_dev_webhook_secret_do_not_use_in_prod',
  'rzp_test_placeholder',
  'change_me_access_secret',
]);

export interface ConfigValidationResult {
  problems: string[];
  summary: string[];
  warnings: string[];
}

/**
 * Pure function (takes an explicit env map rather than reading
 * `process.env` directly) so it can be unit-tested without mutating global
 * process state or spawning a child process - `main.ts`'s
 * `validateEnvironment()` is the thin, side-effecting wrapper that calls
 * this with the real `process.env` and turns the result into a startup
 * abort/log. Never returns or logs an actual secret value - only whether
 * each key is configured, and which ones are missing/weak/placeholder.
 */
export function computeConfigValidation(env: NodeJS.ProcessEnv): ConfigValidationResult {
  const isProduction = env.NODE_ENV === 'production';
  const problems: string[] = [];
  const summary: string[] = [];
  const warnings: string[] = [];

  function checkRequired(key: string, minLength = 0): string | undefined {
    const value = env[key];
    if (!value) {
      problems.push(`${key} is not set`);
      return undefined;
    }
    if (minLength && value.length < minLength) {
      problems.push(`${key} is too short (must be at least ${minLength} characters)`);
    }
    summary.push(`${key}: configured`);
    return value;
  }

  function rejectPlaceholderInProduction(key: string, value: string | undefined): void {
    if (isProduction && value && KNOWN_DEV_PLACEHOLDERS.has(value)) {
      problems.push(`${key} is still set to a local-development placeholder value - a real production credential is required`);
    }
  }

  if (!env.DATABASE_URL) {
    problems.push('DATABASE_URL is not set');
  } else {
    summary.push('DATABASE_URL: configured');
  }

  const jwtSecret = checkRequired('JWT_ACCESS_SECRET', 32);
  rejectPlaceholderInProduction('JWT_ACCESS_SECRET', jwtSecret);

  if (isProduction) {
    if (!env.CORS_ORIGINS || env.CORS_ORIGINS.trim() === '') {
      problems.push('CORS_ORIGINS is empty - no browser origin will be able to call this API in production');
    } else {
      summary.push('CORS_ORIGINS: configured');
    }

    const razorpayKeyId = checkRequired('RAZORPAY_KEY_ID');
    const razorpayKeySecret = checkRequired('RAZORPAY_KEY_SECRET');
    const razorpayWebhookSecret = checkRequired('RAZORPAY_WEBHOOK_SECRET');
    rejectPlaceholderInProduction('RAZORPAY_KEY_ID', razorpayKeyId);
    rejectPlaceholderInProduction('RAZORPAY_KEY_SECRET', razorpayKeySecret);
    rejectPlaceholderInProduction('RAZORPAY_WEBHOOK_SECRET', razorpayWebhookSecret);

    if (env.EMAIL_ENABLED === 'true') {
      checkRequired('EMAIL_HOST');
      checkRequired('EMAIL_USERNAME');
      checkRequired('EMAIL_PASSWORD');
    }

    if (env.STORAGE_PROVIDER === 's3') {
      checkRequired('STORAGE_S3_BUCKET');
      checkRequired('STORAGE_S3_REGION');
      checkRequired('STORAGE_S3_ACCESS_KEY_ID');
      checkRequired('STORAGE_S3_SECRET_ACCESS_KEY');
    }

    if (!env.TRUST_PROXY || env.TRUST_PROXY === 'false') {
      // Not a hard failure - a production deployment reachable directly
      // (no reverse proxy) legitimately wants this false - but it is the
      // single most common production misconfiguration for this app
      // (client IPs / rate limiting / secure-cookie detection all silently
      // wrong behind an unconfigured proxy), so it's surfaced loudly.
      warnings.push(
        'TRUST_PROXY is not set in production - if this API sits behind a reverse proxy/load balancer, client IP detection and secure-cookie/HTTPS detection will be wrong until TRUST_PROXY is configured.',
      );
    }
  }

  return { problems, summary, warnings };
}
