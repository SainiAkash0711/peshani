-- CreateIndex
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");

-- CreateIndex
CREATE INDEX "orders_storeId_placedAt_idx" ON "orders"("storeId", "placedAt");

-- CreateIndex
CREATE INDEX "payments_storeId_createdAt_idx" ON "payments"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "refunds_storeId_createdAt_idx" ON "refunds"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "return_requests_storeId_requestedAt_idx" ON "return_requests"("storeId", "requestedAt");

