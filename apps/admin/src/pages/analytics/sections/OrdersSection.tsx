import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiClient } from '../../../lib/api-client';
import { useAuth } from '../../../lib/auth-context';
import { SectionCard, EmptyNote } from '../../../components/analytics/SectionCard';
import { ExportButton } from '../../../components/analytics/ExportButton';
import { StatCard } from '../../../components/analytics/StatCard';
import { statGridStyle, tableStyle, thStyle, tdStyle } from '../../../styles';
import { buildRangeParams, DateRangeSelection, isRangeReady } from '../../../lib/analytics-range';
import { formatEnumLabel, formatMoney, formatNumber, toNumber } from '../../../lib/analytics-format';
import { CHART_CHROME, CHART_COLORS } from '../../../lib/analytics-colors';
import { OrderStatusCounts, OrdersResponse } from '../../../types/analytics';
import { OrderStatus } from '../../../types/orders';

const ORDER_STATUS_ORDER: OrderStatus[] = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PROCESSING',
  'PACKED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
];

// Fixed identity -> color assignment (never re-derived from array position after filtering).
const ORDER_STATUS_COLOR: Record<OrderStatus, string> = {
  PENDING_PAYMENT: CHART_COLORS[3],
  CONFIRMED: CHART_COLORS[0],
  PROCESSING: CHART_COLORS[4],
  PACKED: CHART_COLORS[6],
  SHIPPED: CHART_COLORS[1],
  DELIVERED: CHART_COLORS[2],
  CANCELLED: CHART_COLORS[7],
};

function tickDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function statusRows(byStatus: OrderStatusCounts) {
  return ORDER_STATUS_ORDER.map((status) => ({ status, count: byStatus[status] ?? 0 })).filter((r) => r.count > 0);
}

export function OrdersSection({ range }: { range: DateRangeSelection }) {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('analytics.orders');
  const ready = isRangeReady(range);
  const params = buildRangeParams(range);

  const query = useQuery({
    queryKey: ['analytics', 'orders', range],
    queryFn: () => apiClient.get<OrdersResponse>(`/admin/analytics/orders?${params.toString()}`),
    enabled: canRead && ready,
  });

  if (!canRead) return null;

  const data = query.data;
  const trend = data?.dailyTrend ?? [];
  const rows = data ? statusRows(data.byStatus) : [];
  const totalForPercent = rows.reduce((sum, r) => sum + r.count, 0);

  return (
    <SectionCard
      title="Orders"
      range={data?.range}
      isLoading={query.isLoading}
      isError={query.isError}
      errorMessage="Failed to load order analytics."
      actions={<ExportButton path={`/admin/analytics/export/orders?${params.toString()}`} filename="orders.csv" />}
    >
      {data && (
        <div style={{ ...statGridStyle, marginBottom: 20 }}>
          <StatCard label="Total Orders" value={formatNumber(data.total)} />
          <StatCard label="Confirmed" value={formatNumber(data.confirmed)} />
          <StatCard label="Delivered" value={formatNumber(data.delivered)} />
          <StatCard label="Cancelled" value={formatNumber(data.cancelled)} />
          <StatCard label="Pending Payment" value={formatNumber(data.pendingPayment)} />
          <StatCard label="Avg Items / Order" value={data.averageItemsPerOrder.toFixed(2)} />
        </div>
      )}

      <h3 style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>Orders Trend</h3>
      {trend.length === 0 ? (
        <EmptyNote />
      ) : (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Order Count</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trend} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                <CartesianGrid stroke={CHART_CHROME.grid} vertical={false} />
                <XAxis dataKey="date" tickFormatter={tickDate} stroke={CHART_CHROME.axis} tick={{ fontSize: 12 }} />
                <YAxis stroke={CHART_CHROME.axis} tick={{ fontSize: 12 }} width={40} allowDecimals={false} />
                <Tooltip labelFormatter={(v) => tickDate(String(v))} formatter={(value) => [formatNumber(toNumber(value)), 'Orders']} />
                <Bar dataKey="orders" name="Orders" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Sales</div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                <CartesianGrid stroke={CHART_CHROME.grid} vertical={false} />
                <XAxis dataKey="date" tickFormatter={tickDate} stroke={CHART_CHROME.axis} tick={{ fontSize: 12 }} />
                <YAxis stroke={CHART_CHROME.axis} tick={{ fontSize: 12 }} tickFormatter={(v: number) => formatMoney(v)} width={90} />
                <Tooltip labelFormatter={(v) => tickDate(String(v))} formatter={(value) => [formatMoney(toNumber(value)), 'Sales']} />
                <Line type="monotone" dataKey="sales" name="Sales" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <h3 style={{ fontSize: 13, color: '#6b7280', margin: '20px 0 8px' }}>Order Status Distribution</h3>
      {rows.length === 0 ? (
        <EmptyNote />
      ) : (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <ResponsiveContainer width={260} height={220}>
            <PieChart>
              <Pie data={rows} dataKey="count" nameKey="status" innerRadius={50} outerRadius={90} paddingAngle={2}>
                {rows.map((r) => (
                  <Cell key={r.status} fill={ORDER_STATUS_COLOR[r.status]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, _name, item) => [
                  formatNumber(toNumber(value)),
                  formatEnumLabel(String((item?.payload as { status?: string } | undefined)?.status ?? '')),
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
          <table style={{ ...tableStyle, flex: '1 1 260px' }}>
            <thead>
              <tr>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Orders</th>
                <th style={thStyle}>%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.status}>
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 999, background: ORDER_STATUS_COLOR[r.status], marginRight: 8 }} />
                    {formatEnumLabel(r.status)}
                  </td>
                  <td style={tdStyle}>{formatNumber(r.count)}</td>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>{totalForPercent > 0 ? ((r.count / totalForPercent) * 100).toFixed(1) : '0.0'}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
