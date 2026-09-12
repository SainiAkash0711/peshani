import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useAuth } from '../../../lib/auth-context';
import { SectionCard } from '../../../components/analytics/SectionCard';
import { ExportButton } from '../../../components/analytics/ExportButton';
import { StatCard } from '../../../components/analytics/StatCard';
import { statGridStyle, tableStyle, thStyle, tdStyle } from '../../../styles';
import { buildRangeParams, DateRangeSelection, isRangeReady } from '../../../lib/analytics-range';
import { formatDuration, formatEnumLabel, formatNumber } from '../../../lib/analytics-format';
import { ReturnsResponse } from '../../../types/analytics';
import { ReturnStatus } from '../../../types/returns';

const RETURN_STATUS_ORDER: ReturnStatus[] = [
  'REQUESTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'IN_TRANSIT',
  'RECEIVED',
  'REFUND_PENDING',
  'REFUND_INITIATED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'COMPLETED',
];

export function ReturnsSection({ range }: { range: DateRangeSelection }) {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('analytics.returns');
  const ready = isRangeReady(range);
  const params = buildRangeParams(range);

  const query = useQuery({
    queryKey: ['analytics', 'returns', range],
    queryFn: () => apiClient.get<ReturnsResponse>(`/admin/analytics/returns?${params.toString()}`),
    enabled: canRead && ready,
  });

  if (!canRead) return null;

  const data = query.data;
  const durations = data?.averageDurationsSeconds;

  return (
    <SectionCard
      title="Returns"
      range={data?.range}
      isLoading={query.isLoading}
      isError={query.isError}
      errorMessage="Failed to load return analytics."
      actions={<ExportButton path={`/admin/analytics/export/returns?${params.toString()}`} filename="returns.csv" />}
    >
      {data && (
        <>
          <div style={{ ...statGridStyle, marginBottom: 20 }}>
            <StatCard label="Total Requests" value={formatNumber(data.totalRequests)} />
            <StatCard label="Requested Quantity" value={formatNumber(data.requestedQuantity)} />
            <StatCard label="Approved" value={formatNumber(data.approved)} />
            <StatCard label="Rejected" value={formatNumber(data.rejected)} />
            <StatCard label="Cancelled" value={formatNumber(data.cancelled)} />
            <StatCard label="Received" value={formatNumber(data.received)} />
            <StatCard label="Completed" value={formatNumber(data.completed)} />
          </div>

          <h3 style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>By Status</h3>
          <div style={{ overflowX: 'auto', marginBottom: 20 }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {RETURN_STATUS_ORDER.map((s) => (
                    <th key={s} style={thStyle}>
                      {formatEnumLabel(s)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {RETURN_STATUS_ORDER.map((s) => (
                    <td key={s} style={tdStyle}>
                      {formatNumber(data.byStatus[s] ?? 0)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <h3 style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>Average Durations</h3>
          <div style={statGridStyle}>
            <StatCard label="Request → Approval" value={formatDuration(durations?.requestToApproval ?? null)} />
            <StatCard label="Approval → Received" value={formatDuration(durations?.approvalToReceived ?? null)} />
            <StatCard label="Received → Refund Initiated" value={formatDuration(durations?.receivedToRefundInitiated ?? null)} />
            <StatCard label="Refund Initiated → Completed" value={formatDuration(durations?.refundInitiatedToCompleted ?? null)} />
          </div>
        </>
      )}
    </SectionCard>
  );
}
