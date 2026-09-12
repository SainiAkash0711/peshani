import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiClient } from '../../../lib/api-client';
import { useAuth } from '../../../lib/auth-context';
import { SectionCard, EmptyNote } from '../../../components/analytics/SectionCard';
import { ExportButton } from '../../../components/analytics/ExportButton';
import { StatCard } from '../../../components/analytics/StatCard';
import { statGridStyle, tableStyle, thStyle, tdStyle } from '../../../styles';
import { buildRangeParams, DateRangeSelection, isRangeReady } from '../../../lib/analytics-range';
import { formatMoney, formatNumber, formatDateShort, toNumber } from '../../../lib/analytics-format';
import { CHART_CHROME, CHART_COLORS } from '../../../lib/analytics-colors';
import { CustomersResponse } from '../../../types/analytics';

function tickDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function customerName(c: { firstName: string | null; lastName: string | null; email: string }): string {
  const full = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return full || c.email;
}

export function CustomersSection({ range }: { range: DateRangeSelection }) {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('analytics.customers');
  const ready = isRangeReady(range);

  const params = buildRangeParams(range);
  params.set('limit', '10');

  const query = useQuery({
    queryKey: ['analytics', 'customers', range],
    queryFn: () => apiClient.get<CustomersResponse>(`/admin/analytics/customers?${params.toString()}`),
    enabled: canRead && ready,
  });

  if (!canRead) return null;

  const data = query.data;
  const growth = data?.growth ?? [];
  const topCustomers = data?.topCustomers ?? [];

  return (
    <SectionCard
      title="Customers"
      range={data?.range}
      isLoading={query.isLoading}
      isError={query.isError}
      errorMessage="Failed to load customer analytics."
      actions={<ExportButton path={`/admin/analytics/export/customers?${params.toString()}`} filename="customers.csv" />}
    >
      {data && (
        <div style={{ ...statGridStyle, marginBottom: 20 }}>
          <StatCard label="Total Customers" value={formatNumber(data.totalCustomers)} />
          <StatCard label="New Customers" value={formatNumber(data.newCustomers)} />
          <StatCard label="Returning Customers" value={formatNumber(data.returningCustomers)} />
          <StatCard label="One-time Customers" value={formatNumber(data.oneTimeCustomers)} />
          <StatCard label="Completed-order Customers" value={formatNumber(data.customersWithCompletedOrders)} />
          <StatCard label="Avg Orders / Customer" value={data.averageOrdersPerCustomer.toFixed(2)} />
        </div>
      )}

      <h3 style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>Customer Growth</h3>
      {growth.length === 0 ? (
        <EmptyNote />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={growth} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
            <CartesianGrid stroke={CHART_CHROME.grid} vertical={false} />
            <XAxis dataKey="date" tickFormatter={tickDate} stroke={CHART_CHROME.axis} tick={{ fontSize: 12 }} />
            <YAxis stroke={CHART_CHROME.axis} tick={{ fontSize: 12 }} width={40} allowDecimals={false} />
            <Tooltip labelFormatter={(v) => tickDate(String(v))} formatter={(value) => [formatNumber(toNumber(value)), 'New Customers']} />
            <Bar dataKey="newCustomers" name="New Customers" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}

      <h3 style={{ fontSize: 13, color: '#6b7280', margin: '20px 0 8px' }}>Top Customers</h3>
      {topCustomers.length === 0 ? (
        <EmptyNote />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Customer</th>
                <th style={thStyle}>Orders</th>
                <th style={thStyle}>Total Spend</th>
                <th style={thStyle}>Last Order</th>
              </tr>
            </thead>
            <tbody>
              {topCustomers.map((c) => (
                <tr key={c.userId}>
                  <td style={tdStyle}>
                    <div>{customerName(c)}</div>
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>{c.email}</div>
                  </td>
                  <td style={tdStyle}>{formatNumber(c.orderCount)}</td>
                  <td style={tdStyle}>{formatMoney(c.totalSpend)}</td>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>{formatDateShort(c.lastOrderDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
