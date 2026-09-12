-- Phase 13 - Security Hardening.
--
-- Hand-curated from `prisma migrate diff`: the diff also proposed dropping
-- products_name_trgm_idx / products_short_description_trgm_idx, which are
-- raw-SQL-only indexes deliberately not modeled in schema.prisma (see the
-- Phase 12 search-indexes migration's own comment) - excluded here, same as
-- every prior phase's migration that hit this.
CREATE TABLE "used_password_reset_tokens" (
    "jti" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "used_password_reset_tokens_pkey" PRIMARY KEY ("jti")
);
