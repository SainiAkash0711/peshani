import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useAuth } from '../../../lib/auth-context';
import { SectionCard } from '../../../components/analytics/SectionCard';
import { ExportButton } from '../../../components/analytics/ExportButton';
import { StatCard } from '../../../components/analytics/StatCard';
import { statGridStyle } from '../../../styles';
import { buildRangeParams, DateRangeSelection, isRangeReady } from '../../../lib/analytics-range';
import { formatMoney, formatNumber } from '../../../lib/analytics-format';
import { RefundsResponse } from '../../../types/analytics';

export function RefundsSection({ range }: { range: DateRangeSelection }) {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('analytics.refunds');
  const ready = isRangeReady(range);
  const params = buildRangeParams(range);

  const query = useQuery({
    queryKey: ['analytics', 'refunds', range],
    queryFn: () => apiClient.get<RefundsResponse>(`/admin/analytics/refunds?${params.toString()}`),
    enabled: canRead && ready,
  });

  if (!canRead) return null;

  const data = query.data;

  return (
    <SectionCard
      title="Refunds"
      range={data?.range}
      isLoading={query.isLoading}
      isError={query.isError}
      errorMessage="Failed to load refund analytics."
      actions={<ExportButton path={`/admin/analytics/export/refunds?${params.toString()}`} filename="refunds.csv" />}
    >
      {data && (
        <>
          <div style={statGridStyle}>
            <StatCard label="Total Refunds" value={formatNumber(data.totalRefunds)} />
            <StatCard label="Successful" value={formatNumber(data.successfulCount)} tone="good" />
            <StatCard label="Failed" value={formatNumber(data.failedCount)} tone={data.failedCount > 0 ? 'critical' : 'default'} />
            <StatCard label="Successful Amount" value={formatMoney(data.successfulAmount)} />
            <StatCard label="Failed Amount" value={formatMoney(data.failedAmount)} />
          </div>

          {/* UNKNOWN-status refunds are a distinct, unresolved figure - never merged into
              successful/failed as if it were one of those two outcomes. */}
          <div
            style={{
              marginTop: 16,
              padding: '14px 16px',
              borderRadius: 8,
              background: '#fffbeb',
              border: '1px solid #fde68a',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                ⚠ Needs Attention — Unresolved (UNKNOWN status)
              </div>
              <div style={{ fontSize: 12, color: '#92400e', marginTop: 2 }}>
                Refunds whose provider outcome could not be confirmed - require manual reconciliation.
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#b45309' }}>{formatNumber(data.unknownCount)} refunds</div>
              <div style={{ fontSize: 13, color: '#b45309' }}>{formatMoney(data.unresolvedUnknownAmount)}</div>
            </div>
          </div>
        </>
      )}
    </SectionCard>
  );
}
