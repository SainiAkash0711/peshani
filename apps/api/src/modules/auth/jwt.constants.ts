/**
 * Explicit algorithm/issuer/audience pinning - previously the signing side
 * left `algorithm` to jsonwebtoken's default (HS256, since the secret is a
 * plain string) and neither side set `issuer`/`audience` at all. Pinning
 * these here (used identically by both the signing call sites in
 * AuthService and the verifying JwtStrategy/verifyPurposeToken) closes off
 * any future accidental "alg:none"-style confusion and makes a token's
 * intended origin/consumer explicit and checkable, without requiring a
 * token-format migration for this project (no real production sessions
 * exist yet to preserve compatibility with).
 */
export const JWT_ALGORITHM = 'HS256' as const;
export const JWT_ISSUER = 'peshani-api';
export const JWT_AUDIENCE = 'peshani-client';
