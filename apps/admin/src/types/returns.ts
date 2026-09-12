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

export type ReturnReason =
  | 'DAMAGED'
  | 'DEFECTIVE'
  | 'WRONG_ITEM'
  | 'WRONG_SIZE'
  | 'NOT_AS_DESCRIBED'
  | 'CHANGED_MIND'
  | 'OTHER';

export type ItemCondition = 'NEW' | 'OPENED' | 'USED' | 'DAMAGED' | 'DEFECTIVE';

export type ItemDisposition = 'RESTOCK' | 'DAMAGED' | 'UNSELLABLE';

export type RefundStatus = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';

export interface ReturnOrderItemSnapshot {
  id: string;
  productNameSnapshot: string;
  variantNameSnapshot?: string | null;
  skuSnapshot?: string | null;
  unitPrice: string;
  quantity: number;
}

export interface ReturnItem {
  id: string;
  orderItemId: string;
  quantity: number;
  reason: ReturnReason;
  itemCondition: ItemCondition | null;
  disposition: ItemDisposition | null;
  restockedAt: string | null;
  refundAmount: string;
  orderItem: ReturnOrderItemSnapshot;
}

export interface Refund {
  id: string;
  amount: string;
  currency: string;
  status: RefundStatus;
  provider: string | null;
  providerRefundId: string | null;
  failureReason: string | null;
  initiatedAt: string | null;
  succeededAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

export interface ReturnEvidence {
  id: string;
  url: string;
  mimeType: string;
  fileSize: number;
  originalFilename: string | null;
  createdAt: string;
}

export interface ReturnOrderRef {
  id: string;
  orderNumber: string;
  placedAt: string;
  status: string;
  currency: string;
}

export interface ReturnUserRef {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export interface ReturnRequest {
  id: string;
  status: ReturnStatus;
  reason: ReturnReason;
  customerComment?: string | null;
  adminComment?: string | null;
  requestedAt: string;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  receivedAt?: string | null;
  inspectedAt?: string | null;
  refundInitiatedAt?: string | null;
  completedAt?: string | null;
  items: ReturnItem[];
  evidence: ReturnEvidence[];
  refunds: Refund[];
  order: ReturnOrderRef;
  user: ReturnUserRef;
}

// The /admin/returns endpoint returns a flat pagination shape
// ({ items, total, page, pageSize }), matching /admin/notifications rather
// than the { items, pagination: {...} } shape used by most other admin list
// endpoints - keep this separate from the shared PaginatedResult<T> type.
export interface AdminReturnsListResult {
  items: ReturnRequest[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InspectItemInput {
  returnItemId: string;
  itemCondition: ItemCondition;
  disposition: ItemDisposition;
}
