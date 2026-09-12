export type ReturnReason =
  | 'DAMAGED'
  | 'DEFECTIVE'
  | 'WRONG_ITEM'
  | 'WRONG_SIZE'
  | 'NOT_AS_DESCRIBED'
  | 'CHANGED_MIND'
  | 'OTHER';

export type ReturnStatus =
  | 'REQUESTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'IN_TRANSIT'
  | 'RECEIVED'
  | 'REFUND_PENDING'
  | 'REFUND_INITIATED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'COMPLETED';

export type ItemCondition = 'NEW' | 'OPENED' | 'USED' | 'DAMAGED' | 'DEFECTIVE';
export type ItemDisposition = 'RESTOCK' | 'DAMAGED' | 'UNSELLABLE';
export type RefundStatus = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';

export interface ReturnEligibilityItem {
  orderItemId: string;
  productId: string;
  variantId: string | null;
  productNameSnapshot: string;
  purchasedQuantity: number;
  alreadyReturnedQuantity: number;
  maxReturnableQuantity: number;
  unitPrice: string;
}

export interface ReturnEligibility {
  eligible: boolean;
  reason?: string;
  deliveredAt?: string;
  returnWindowDays: number;
  eligibleUntil?: string;
  items: ReturnEligibilityItem[];
}

export interface ReturnOrderItemSnapshot {
  id: string;
  productNameSnapshot: string;
  variantNameSnapshot: string | null;
  skuSnapshot: string;
  unitPrice: string;
  quantity: number;
}

export interface ReturnItem {
  id: string;
  returnRequestId: string;
  orderItemId: string;
  quantity: number;
  reason: ReturnReason;
  itemCondition: ItemCondition | null;
  disposition: ItemDisposition | null;
  restockedAt: string | null;
  refundAmount: string | null;
  createdAt: string;
  updatedAt: string;
  orderItem: ReturnOrderItemSnapshot;
}

export interface ReturnEvidence {
  id: string;
  url: string;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  contentHash: string;
  uploadedByUserId: string;
  createdAt: string;
}

export interface Refund {
  id: string;
  amount: string;
  currency: string;
  status: RefundStatus;
  provider: string;
  providerRefundId: string | null;
  failureReason: string | null;
  initiatedAt: string | null;
  succeededAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

export interface ReturnRequest {
  id: string;
  storeId: string;
  orderId: string;
  userId: string;
  status: ReturnStatus;
  reason: ReturnReason;
  customerComment: string | null;
  adminComment: string | null;
  requestedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
  inTransitAt: string | null;
  receivedAt: string | null;
  inspectedAt: string | null;
  refundInitiatedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: ReturnItem[];
  evidence: ReturnEvidence[];
  refunds: Refund[];
  order: { id: string; orderNumber: string; currency: string };
}

export interface ReturnListResult {
  items: ReturnRequest[];
  total: number;
  page: number;
  pageSize: number;
}
