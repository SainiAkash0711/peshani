import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiClient } from '../../../lib/api-client';
import { useAuth } from '../../../lib/auth-context';
import { SectionCard, EmptyNote } from '../../../components/analytics/SectionCard';
import { ExportButton } from '../../../components/analytics/ExportButton';
import { tableStyle, thStyle, tdStyle, inputStyle } from '../../../styles';
import { buildRangeParams, DateRangeSelection, isRangeReady } from '../../../lib/analytics-range';
import { formatMoney, formatNumber, toNumber } from '../../../lib/analytics-format';
import { CHART_CHROME, CHART_COLORS } from '../../../lib/analytics-colors';
import { SalesGranularity, SalesResponse } from '../../../types/analytics';

function tickDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function SalesSection({ range }: { range: DateRangeSelection }) {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('analytics.sales');
  const ready = isRangeReady(range);
  const [granularity, setGranularity] = useState<SalesGranularity>('daily');

  const params = buildRangeParams(range);
  params.set('granularity', granularity);

  const query = useQuery({
    queryKey: ['analytics', 'sales', range, granularity],
    queryFn: () => apiClient.get<SalesResponse>(`/admin/analytics/sales?${params.toString()}`),
    enabled: canRead && ready,
  });

  if (!canRead) return null;

  const data = query.data;
  const trend = data?.trend ?? [];
  const byProduct = data?.byProduct ?? [];
  const byCategory = data?.byCategory ?? [];
  const byBrand = data?.byBrand ?? [];

  return (
    <SectionCard
      title="Sales"
      range={data?.range}
      isLoading={query.isLoading}
      isError={query.isError}
      errorMessage="Failed to load sales analytics."
      actions={
        <>
          <select
            style={{ ...inputStyle, minWidth: 120 }}
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as SalesGranularity)}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <ExportButton path={`/admin/analytics/export/sales?${params.toString()}`} filename="sales.csv" />
        </>
      }
    >
      <h3 style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>Sales Trend</h3>
      {trend.length === 0 ? (
        <EmptyNote />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trend} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid stroke={CHART_CHROME.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={tickDate} stroke={CHART_CHROME.axis} tick={{ fontSize: 12 }} />
              <YAxis stroke={CHART_CHROME.axis} tick={{ fontSize: 12 }} tickFormatter={(v: number) => formatMoney(v)} width={90} />
              <Tooltip
                labelFormatter={(v) => tickDate(String(v))}
                formatter={(value, name) => [formatMoney(toNumber(value)), String(name)]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="grossSales" name="Gross Sales" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="discounts" name="Discounts" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="refunds" name="Refunds" stroke={CHART_COLORS[7]} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="netSales" name="Net Sales" stroke={CHART_COLORS[2]} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>

          <h3 style={{ fontSize: 13, color: '#6b7280', margin: '16px 0 8px' }}>Orders per Period</h3>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={trend} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid stroke={CHART_CHROME.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={tickDate} stroke={CHART_CHROME.axis} tick={{ fontSize: 12 }} />
              <YAxis stroke={CHART_CHROME.axis} tick={{ fontSize: 12 }} width={40} allowDecimals={false} />
              <Tooltip labelFormatter={(v) => tickDate(String(v))} formatter={(value) => [formatNumber(toNumber(value)), 'Orders']} />
              <Bar dataKey="orders" name="Orders" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}

      <h3 style={{ fontSize: 13, color: '#6b7280', margin: '20px 0 8px' }}>Top Products</h3>
      {byProduct.length === 0 ? (
        <EmptyNote />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Product</th>
                <th style={thStyle}>SKU</th>
                <th style={thStyle}>Units Sold</th>
                <th style={thStyle}>Gross Sales</th>
                <th style={thStyle}>Refunds</th>
                <th style={thStyle}>Net Sales</th>
              </tr>
            </thead>
            <tbody>
              {byProduct.map((p) => (
                <tr key={p.productId}>
                  <td style={tdStyle}>{p.productName}</td>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>{p.sku}</td>
                  <td style={tdStyle}>{formatNumber(p.unitsSold)}</td>
                  <td style={tdStyle}>{formatMoney(p.grossSales)}</td>
                  <td style={{ ...tdStyle, color: '#dc2626' }}>{formatMoney(p.refundAmount)}</td>
                  <td style={tdStyle}>{formatMoney(p.netSales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 20 }}>
        <div style={{ flex: '1 1 320px' }}>
          <h3 style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>Top Categories</h3>
          {byCategory.length === 0 ? (
            <EmptyNote />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Category</th>
                  <th style={thStyle}>Units</th>
                  <th style={thStyle}>Sales</th>
                  <th style={thStyle}>%</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.map((c) => (
                  <tr key={c.categoryId}>
                    <td style={tdStyle}>{c.categoryName}</td>
                    <td style={tdStyle}>{formatNumber(c.unitsSold)}</td>
                    <td style={tdStyle}>{formatMoney(c.sales)}</td>
                    <td style={{ ...tdStyle, color: '#6b7280' }}>{c.percentage.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ flex: '1 1 320px' }}>
          <h3 style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>Top Brands</h3>
          {byBrand.length === 0 ? (
            <EmptyNote />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Brand</th>
                  <th style={thStyle}>Units</th>
                  <th style={thStyle}>Sales</th>
                  <th style={thStyle}>%</th>
                </tr>
              </thead>
              <tbody>
                {byBrand.map((b) => (
                  <tr key={b.brandId}>
                    <td style={tdStyle}>{b.brandName}</td>
                    <td style={tdStyle}>{formatNumber(b.unitsSold)}</td>
                    <td style={tdStyle}>{formatMoney(b.sales)}</td>
                    <td style={{ ...tdStyle, color: '#6b7280' }}>{b.percentage.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
