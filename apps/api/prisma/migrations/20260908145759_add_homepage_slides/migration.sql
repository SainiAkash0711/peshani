-- CreateTable
CREATE TABLE "homepage_slides" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "storageKey" TEXT,
    "originalFilename" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "contentHash" TEXT,
    "title" TEXT,
    "subtitle" TEXT,
    "linkUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "homepage_slides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "homepage_slides_storeId_isActive_sortOrder_idx" ON "homepage_slides"("storeId", "isActive", "sortOrder");

-- AddForeignKey
ALTER TABLE "homepage_slides" ADD CONSTRAINT "homepage_slides_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
