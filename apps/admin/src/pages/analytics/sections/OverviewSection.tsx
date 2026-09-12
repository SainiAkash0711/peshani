import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useAuth } from '../../../lib/auth-context';
import { SectionCard } from '../../../components/analytics/SectionCard';
import { StatCard } from '../../../components/analytics/StatCard';
import { statGridStyle } from '../../../styles';
import { buildRangeParams, DateRangeSelection, isRangeReady } from '../../../lib/analytics-range';
import { formatMoney, formatNumber } from '../../../lib/analytics-format';
import { OverviewResponse } from '../../../types/analytics';

export function OverviewSection({ range }: { range: DateRangeSelection }) {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('analytics.read');
  const ready = isRangeReady(range);

  const query = useQuery({
    queryKey: ['analytics', 'overview', range],
    queryFn: () => apiClient.get<OverviewResponse>(`/admin/analytics/overview?${buildRangeParams(range).toString()}`),
    enabled: canRead && ready,
  });

  if (!canRead) return null;

  const data = query.data;

  return (
    <SectionCard
      title="Overview"
      range={data?.range}
      isLoading={query.isLoading}
      isError={query.isError}
      errorMessage="Failed to load the overview KPIs."
    >
      {data && (
        <div style={statGridStyle}>
          <StatCard label="Gross Sales" value={formatMoney(data.sales.grossSales)} />
          <StatCard label="Net Sales" value={formatMoney(data.sales.netSales)} />
          <StatCard label="Discounts" value={formatMoney(data.sales.discounts)} />
          <StatCard label="Successful Refunds" value={formatMoney(data.sales.successfulRefunds)} />
          <StatCard label="Average Order Value" value={formatMoney(data.averageOrderValue)} />
          <StatCard label="Total Orders" value={formatNumber(data.orders.total)} />
          <StatCard label="Confirmed Orders" value={formatNumber(data.orders.confirmed)} />
          <StatCard label="Delivered Orders" value={formatNumber(data.orders.delivered)} />
          <StatCard label="Cancelled Orders" value={formatNumber(data.orders.cancelled)} tone={data.orders.cancelled > 0 ? 'warning' : 'default'} />
          <StatCard label="Pending Payment Orders" value={formatNumber(data.orders.pendingPayment)} />
          <StatCard label="Total Customers" value={formatNumber(data.customers.totalCustomers)} />
          <StatCard label="New Customers" value={formatNumber(data.customers.newCustomers)} />
          <StatCard label="Returning Customers" value={formatNumber(data.customers.returningCustomers)} />
        </div>
      )}
    </SectionCard>
  );
}
