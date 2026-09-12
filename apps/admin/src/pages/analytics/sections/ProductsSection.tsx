import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useAuth } from '../../../lib/auth-context';
import { SectionCard, EmptyNote } from '../../../components/analytics/SectionCard';
import { ExportButton } from '../../../components/analytics/ExportButton';
import { Button } from '../../../components/Button';
import { tableStyle, thStyle, tdStyle } from '../../../styles';
import { buildRangeParams, DateRangeSelection, isRangeReady } from '../../../lib/analytics-range';
import { formatMoney, formatNumber } from '../../../lib/analytics-format';
import { ProductBreakdownRow, ProductsResponse } from '../../../types/analytics';

function ProductTable({ rows }: { rows: ProductBreakdownRow[] }) {
  if (rows.length === 0) return <EmptyNote />;
  return (
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
          {rows.map((p) => (
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
  );
}

export function ProductsSection({ range }: { range: DateRangeSelection }) {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('analytics.products');
  const ready = isRangeReady(range);
  const [tab, setTab] = useState<'revenue' | 'units' | 'lowest' | 'zero'>('revenue');

  const params = buildRangeParams(range);
  params.set('limit', '10');

  const query = useQuery({
    queryKey: ['analytics', 'products', range],
    queryFn: () => apiClient.get<ProductsResponse>(`/admin/analytics/products?${params.toString()}`),
    enabled: canRead && ready,
  });

  if (!canRead) return null;

  const data = query.data;

  return (
    <SectionCard
      title="Products"
      range={data?.range}
      isLoading={query.isLoading}
      isError={query.isError}
      errorMessage="Failed to load product analytics."
      actions={<ExportButton path={`/admin/analytics/export/products?${params.toString()}`} filename="products.csv" />}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {(
          [
            ['revenue', 'Top by Revenue'],
            ['units', 'Top by Units'],
            ['lowest', 'Lowest Selling'],
            ['zero', 'Zero Sales'],
          ] as const
        ).map(([key, label]) => (
          <Button key={key} variant={tab === key ? 'primary' : 'secondary'} onClick={() => setTab(key)}>
            {label}
          </Button>
        ))}
      </div>

      {!data ? (
        <EmptyNote />
      ) : tab === 'revenue' ? (
        <ProductTable rows={data.topByRevenue} />
      ) : tab === 'units' ? (
        <ProductTable rows={data.topByUnits} />
      ) : tab === 'lowest' ? (
        <ProductTable rows={data.lowestSelling} />
      ) : data.zeroSalesProducts.length === 0 ? (
        <EmptyNote message="No products with zero sales for this period." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Product</th>
                <th style={thStyle}>SKU</th>
              </tr>
            </thead>
            <tbody>
              {data.zeroSalesProducts.map((p) => (
                <tr key={p.productId}>
                  <td style={tdStyle}>{p.productName}</td>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>{p.sku}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
