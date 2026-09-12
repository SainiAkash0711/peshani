import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useAuth } from '../../../lib/auth-context';
import { SectionCard, EmptyNote } from '../../../components/analytics/SectionCard';
import { StatCard } from '../../../components/analytics/StatCard';
import { statGridStyle, tableStyle, thStyle, tdStyle } from '../../../styles';
import { buildRangeParams, DateRangeSelection, isRangeReady } from '../../../lib/analytics-range';
import { formatMoney, formatNumber } from '../../../lib/analytics-format';
import { PromotionsResponse } from '../../../types/analytics';

export function PromotionsSection({ range }: { range: DateRangeSelection }) {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('analytics.promotions');
  const ready = isRangeReady(range);

  const query = useQuery({
    queryKey: ['analytics', 'promotions', range],
    queryFn: () => apiClient.get<PromotionsResponse>(`/admin/analytics/promotions?${buildRangeParams(range).toString()}`),
    enabled: canRead && ready,
  });

  if (!canRead) return null;

  const data = query.data;
  const topCoupons = data?.topCoupons ?? [];

  return (
    <SectionCard
      title="Promotions"
      range={data?.range}
      isLoading={query.isLoading}
      isError={query.isError}
      errorMessage="Failed to load promotion analytics."
    >
      {data && (
        <div style={{ ...statGridStyle, marginBottom: 20 }}>
          <StatCard label="Consumed Redemptions" value={formatNumber(data.consumedRedemptions)} />
          <StatCard label="Reserved Redemptions" value={formatNumber(data.reservedRedemptions)} />
          <StatCard label="Released Redemptions" value={formatNumber(data.releasedRedemptions)} />
          <StatCard label="Total Discount Value" value={formatMoney(data.totalDiscountValue)} />
        </div>
      )}

      <h3 style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>Top Coupons</h3>
      {topCoupons.length === 0 ? (
        <EmptyNote />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Code</th>
                <th style={thStyle}>Redemptions</th>
                <th style={thStyle}>Discount Value</th>
              </tr>
            </thead>
            <tbody>
              {topCoupons.map((c) => (
                <tr key={c.code}>
                  <td style={tdStyle}>{c.code}</td>
                  <td style={tdStyle}>{formatNumber(c.redemptions)}</td>
                  <td style={tdStyle}>{formatMoney(c.discountValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
