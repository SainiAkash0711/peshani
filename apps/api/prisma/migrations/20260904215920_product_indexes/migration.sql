-- CreateIndex
CREATE INDEX "product_attributes_attributeId_idx" ON "product_attributes"("attributeId");

-- CreateIndex
CREATE INDEX "product_categories_categoryId_idx" ON "product_categories"("categoryId");

-- CreateIndex
CREATE INDEX "product_tags_tagId_idx" ON "product_tags"("tagId");

-- CreateIndex
CREATE INDEX "products_storeId_productType_idx" ON "products"("storeId", "productType");
