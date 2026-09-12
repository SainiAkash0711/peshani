import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useAuth } from '../../../lib/auth-context';
import { SectionCard, EmptyNote } from '../../../components/analytics/SectionCard';
import { StatCard } from '../../../components/analytics/StatCard';
import { statGridStyle } from '../../../styles';
import { buildRangeParams, DateRangeSelection, isRangeReady } from '../../../lib/analytics-range';
import { formatDuration, formatNumber, formatPercentValue, formatTransitionLabel } from '../../../lib/analytics-format';
import { FulfillmentResponse } from '../../../types/analytics';

export function FulfillmentSection({ range }: { range: DateRangeSelection }) {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('analytics.read');
  const ready = isRangeReady(range);

  const query = useQuery({
    queryKey: ['analytics', 'fulfillment', range],
    queryFn: () => apiClient.get<FulfillmentResponse>(`/admin/analytics/fulfillment?${buildRangeParams(range).toString()}`),
    enabled: canRead && ready,
  });

  if (!canRead) return null;

  const data = query.data;
  // Duration keys are dynamic - only transitions with actual data are present. Render whatever
  // keys exist rather than assuming a fixed set.
  const transitionEntries = data ? Object.entries(data.averageTransitionDurationsSeconds) : [];

  return (
    <SectionCard
      title="Fulfillment"
      range={data?.range}
      isLoading={query.isLoading}
      isError={query.isError}
      errorMessage="Failed to load fulfillment analytics."
    >
      {data && (
        <>
          <div style={{ ...statGridStyle, marginBottom: 20 }}>
            <StatCard label="Processing" value={formatNumber(data.processing)} />
            <StatCard label="Packed" value={formatNumber(data.packed)} />
            <StatCard label="Shipped" value={formatNumber(data.shipped)} />
            <StatCard label="Delivered" value={formatNumber(data.delivered)} />
            <StatCard label="Cancelled Before Fulfillment" value={formatNumber(data.cancelledBeforeFulfillment)} />
            <StatCard label="Delivered %" value={formatPercentValue(data.deliveredPercentage)} />
          </div>

          <h3 style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>Average Transition Durations</h3>
          {transitionEntries.length === 0 ? (
            <EmptyNote message="Not enough data yet for transition durations." />
          ) : (
            <div style={statGridStyle}>
              {transitionEntries.map(([key, seconds]) => (
                <StatCard key={key} label={formatTransitionLabel(key)} value={formatDuration(seconds)} />
              ))}
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
