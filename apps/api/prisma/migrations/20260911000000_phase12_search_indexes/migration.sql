-- Phase 12 - Search & Performance.
--
-- Purely additive: one Postgres extension + trigram GIN indexes to speed up
-- the storefront search's "contains"-tier LIKE/ILIKE matching on product
-- name and shortDescription. These are not modeled in schema.prisma because
-- doing so would require enabling Prisma's `postgresqlExtensions` preview
-- feature just to declare `extensions = [pg_trgm]` on the datasource -
-- unnecessary complexity for what Postgres itself only needs as a plain
-- CREATE EXTENSION + CREATE INDEX. The search service issues raw SQL
-- directly, so no Prisma-side index annotation is required for these to be
-- used by the query planner.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "products_name_trgm_idx" ON "products" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "products_short_description_trgm_idx" ON "products" USING GIN ("shortDescription" gin_trgm_ops);
