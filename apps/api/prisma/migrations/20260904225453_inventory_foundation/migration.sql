-- DropIndex
DROP INDEX "inventory_items_storeId_idx";

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "onHandQuantity" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "inventory_items_storeId_warehouseId_idx" ON "inventory_items"("storeId", "warehouseId");

-- CreateIndex
CREATE INDEX "inventory_items_productId_idx" ON "inventory_items"("productId");

-- CreateIndex
CREATE INDEX "inventory_items_variantId_idx" ON "inventory_items"("variantId");
