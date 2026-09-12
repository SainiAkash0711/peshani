import type { ItemCondition, ItemDisposition, RefundStatus, ReturnReason, ReturnStatus } from '../types/return';

export const RETURN_REASON_OPTIONS: ReturnReason[] = [
  'DAMAGED',
  'DEFECTIVE',
  'WRONG_ITEM',
  'WRONG_SIZE',
  'NOT_AS_DESCRIBED',
  'CHANGED_MIND',
  'OTHER',
];

export const RETURN_REASON_LABEL: Record<ReturnReason, string> = {
  DAMAGED: 'Damaged',
  DEFECTIVE: 'Defective',
  WRONG_ITEM: 'Wrong Item',
  WRONG_SIZE: 'Wrong Size',
  NOT_AS_DESCRIBED: 'Not as Described',
  CHANGED_MIND: 'Changed My Mind',
  OTHER: 'Other',
};

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  REQUESTED: 'Awaiting Review',
  UNDER_REVIEW: 'Under Review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  IN_TRANSIT: 'Item In Transit',
  RECEIVED: 'Received',
  REFUND_PENDING: 'Refund Pending',
  REFUND_INITIATED: 'Refund Initiated',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially Refunded',
  COMPLETED: 'Completed',
};

// Only 3 badge color variants exist in globals.css (green/amber/red), reused
// from product-availability and order-status badges elsewhere in the app.
const GREEN_STATUSES = new Set<ReturnStatus>(['APPROVED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'COMPLETED']);
const RED_STATUSES = new Set<ReturnStatus>(['REJECTED', 'CANCELLED']);

export function returnStatusBadgeClass(status: ReturnStatus): string {
  if (GREEN_STATUSES.has(status)) return 'badge--in-stock';
  if (RED_STATUSES.has(status)) return 'badge--out-of-stock';
  return 'badge--low-stock';
}

export function formatReturnStatusLabel(status: string): string {
  return RETURN_STATUS_LABEL[status as ReturnStatus] ?? status.charAt(0) + status.slice(1).toLowerCase();
}

export const REFUND_STATUS_LABEL: Record<RefundStatus, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
  UNKNOWN: 'Unknown',
  CANCELLED: 'Cancelled',
};

export const ITEM_CONDITION_LABEL: Record<ItemCondition, string> = {
  NEW: 'New',
  OPENED: 'Opened',
  USED: 'Used',
  DAMAGED: 'Damaged',
  DEFECTIVE: 'Defective',
};

export const ITEM_DISPOSITION_LABEL: Record<ItemDisposition, string> = {
  RESTOCK: 'Restocked',
  DAMAGED: 'Damaged (not restocked)',
  UNSELLABLE: 'Unsellable',
};
