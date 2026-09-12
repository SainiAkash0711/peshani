import { RefundStatus, ReturnStatus } from '../../types/returns';

const RETURN_STATUS_STYLES: Record<ReturnStatus, { background: string; color: string }> = {
  REQUESTED: { background: '#f3f4f6', color: '#6b7280' },
  UNDER_REVIEW: { background: '#f3f4f6', color: '#6b7280' },
  APPROVED: { background: '#e0f2fe', color: '#0369a1' },
  IN_TRANSIT: { background: '#e0f2fe', color: '#0369a1' },
  RECEIVED: { background: '#e0f2fe', color: '#0369a1' },
  REFUND_PENDING: { background: '#ede9fe', color: '#6d28d9' },
  REFUND_INITIATED: { background: '#ede9fe', color: '#6d28d9' },
  PARTIALLY_REFUNDED: { background: '#fef9c3', color: '#a16207' },
  REFUNDED: { background: '#dcfce7', color: '#15803d' },
  COMPLETED: { background: '#dcfce7', color: '#15803d' },
  REJECTED: { background: '#fee2e2', color: '#dc2626' },
  CANCELLED: { background: '#f3f4f6', color: '#6b7280' },
};

const REFUND_STATUS_STYLES: Record<RefundStatus, { background: string; color: string }> = {
  PENDING: { background: '#fef9c3', color: '#a16207' },
  PROCESSING: { background: '#dbeafe', color: '#1d4ed8' },
  SUCCEEDED: { background: '#dcfce7', color: '#15803d' },
  FAILED: { background: '#fee2e2', color: '#dc2626' },
  UNKNOWN: { background: '#f3f4f6', color: '#6b7280' },
  CANCELLED: { background: '#f3f4f6', color: '#6b7280' },
};

export function formatEnumLabel(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

function Badge({ background, color, label }: { background: string; color: string; label: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background,
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

export function ReturnStatusBadge({ status }: { status: ReturnStatus }) {
  const style = RETURN_STATUS_STYLES[status] ?? { background: '#f3f4f6', color: '#6b7280' };
  return <Badge {...style} label={formatEnumLabel(status)} />;
}

export function RefundStatusBadge({ status }: { status: RefundStatus }) {
  const style = REFUND_STATUS_STYLES[status] ?? { background: '#f3f4f6', color: '#6b7280' };
  return <Badge {...style} label={formatEnumLabel(status)} />;
}
