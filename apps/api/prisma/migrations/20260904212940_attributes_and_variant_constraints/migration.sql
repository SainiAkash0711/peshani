-- CreateEnum
CREATE TYPE "AttributeType" AS ENUM ('SELECT', 'COLOR', 'TEXT', 'NUMBER');

-- AlterTable
ALTER TABLE "attribute_values" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "attributes" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "type" "AttributeType" NOT NULL DEFAULT 'SELECT';

-- CreateIndex
CREATE INDEX "attributes_storeId_isActive_idx" ON "attributes"("storeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_storeId_barcode_key" ON "product_variants"("storeId", "barcode");

