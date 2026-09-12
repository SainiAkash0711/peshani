-- AlterTable
ALTER TABLE "product_images" ADD COLUMN     "caption" TEXT,
ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "originalFilename" TEXT,
ADD COLUMN     "width" INTEGER;

-- AlterTable
ALTER TABLE "variant_images" ADD COLUMN     "caption" TEXT,
ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "originalFilename" TEXT,
ADD COLUMN     "width" INTEGER;

-- CreateIndex
CREATE INDEX "product_images_productId_isPrimary_idx" ON "product_images"("productId", "isPrimary");

-- CreateIndex
CREATE INDEX "variant_images_variantId_isPrimary_idx" ON "variant_images"("variantId", "isPrimary");
