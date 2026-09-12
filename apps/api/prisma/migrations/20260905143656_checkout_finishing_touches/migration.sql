-- AlterEnum
ALTER TYPE "CartStatus" ADD VALUE 'CONVERTED';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "idempotencyKeyPayloadHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_storeId_userId_idempotencyKey_key" ON "orders"("storeId", "userId", "idempotencyKey");

