import { randomBytes, createHash } from 'node:crypto';

/** Cryptographically random guest cart identity - never contains any embedded data. */
export function generateGuestToken(): string {
  return randomBytes(32).toString('hex');
}

/** Same SHA-256-hash-only-the-hash-is-persisted pattern as RefreshToken.tokenHash. */
export function hashGuestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
