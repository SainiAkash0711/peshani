-- Phase 12 - Search & Performance.
--
-- Hand-curated from `prisma migrate diff` output: that diff also proposed
-- DROPping products_name_trgm_idx / products_short_description_trgm_idx,
-- since those two indexes (added in the prior phase12_search_indexes
-- migration) are raw-SQL-only and deliberately not modeled in
-- schema.prisma (see that migration's own comment) - Prisma's diff tool
-- can't see them in the target datamodel and proposes removing them.
-- Those two DROP INDEX statements are intentionally excluded here.
--
-- Confirmed via EXPLAIN ANALYZE against this dev database's ~14k-product
-- catalog that the home page's isBestseller/isNewArrival queries
-- (WHERE storeId=X AND <flag>=true ORDER BY createdAt DESC LIMIT n) were
-- doing a full sequential scan - isBestseller/isNewArrival had no index at
-- all, and the existing isFeatured index lacked createdAt so still needed a
-- separate sort step. Replaced with 3-column composites that let Postgres
-- satisfy both the filter and the ORDER BY from the same index scan.
DROP INDEX "products_storeId_isFeatured_idx";

CREATE INDEX "products_storeId_isFeatured_createdAt_idx" ON "products"("storeId", "isFeatured", "createdAt");
CREATE INDEX "products_storeId_isBestseller_createdAt_idx" ON "products"("storeId", "isBestseller", "createdAt");
CREATE INDEX "products_storeId_isNewArrival_createdAt_idx" ON "products"("storeId", "isNewArrival", "createdAt");
