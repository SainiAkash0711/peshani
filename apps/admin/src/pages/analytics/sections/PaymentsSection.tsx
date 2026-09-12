import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useAuth } from '../../../lib/auth-context';
import { SectionCard } from '../../../components/analytics/SectionCard';
import { StatCard } from '../../../components/analytics/StatCard';
import { statGridStyle } from '../../../styles';
import { buildRangeParams, DateRangeSelection, isRangeReady } from '../../../lib/analytics-range';
import { formatMoney, formatNumber, formatPercent } from '../../../lib/analytics-format';
import { PaymentsResponse } from '../../../types/analytics';

export function PaymentsSection({ range }: { range: DateRangeSelection }) {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('analytics.payments');
  const ready = isRangeReady(range);

  const query = useQuery({
    queryKey: ['analytics', 'payments', range],
    queryFn: () => apiClient.get<PaymentsResponse>(`/admin/analytics/payments?${buildRangeParams(range).toString()}`),
    enabled: canRead && ready,
  });

  if (!canRead) return null;

  const data = query.data;

  return (
    <SectionCard
      title="Payment Performance"
      range={data?.range}
      isLoading={query.isLoading}
      isError={query.isError}
      errorMessage="Failed to load payment analytics."
    >
      {data && (
        <div style={statGridStyle}>
          <StatCard
            label="Payment Attempts"
            value={formatNumber(data.totalAttempts)}
            hint="Every capture attempt, including retries on the same order"
          />
          <StatCard
            label="Successful Sales"
            value={formatNumber(data.distinctSuccessfulSales)}
            hint="Distinct orders that ended up successfully paid"
          />
          <StatCard label="Successful Payments" value={formatNumber(data.successfulPayments)} />
          <StatCard label="Failed Payments" value={formatNumber(data.failedPayments)} tone={data.failedPayments > 0 ? 'warning' : 'default'} />
          <StatCard label="Pending Payments" value={formatNumber(data.pendingPayments)} />
          <StatCard label="Success Rate" value={formatPercent(data.successRate)} />
          <StatCard label="Captured Amount" value={formatMoney(data.capturedAmount)} />
          <StatCard label="Failed Amount" value={formatMoney(data.failedAmount)} />
        </div>
      )}
    </SectionCard>
  );
}
