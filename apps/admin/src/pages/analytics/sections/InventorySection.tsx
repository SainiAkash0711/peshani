import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useAuth } from '../../../lib/auth-context';
import { SectionCard, EmptyNote } from '../../../components/analytics/SectionCard';
import { StatCard } from '../../../components/analytics/StatCard';
import { statGridStyle, tableStyle, thStyle, tdStyle } from '../../../styles';
import { formatNumber } from '../../../lib/analytics-format';
import { InventoryResponse } from '../../../types/analytics';

/** Inventory is a live snapshot, not date-range filtered - the backend response carries no
 * `range` block, so this section fetches once and ignores the shared date-range control. */
export function InventorySection() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('analytics.inventory');

  const query = useQuery({
    queryKey: ['analytics', 'inventory'],
    queryFn: () => apiClient.get<InventoryResponse>('/admin/analytics/inventory'),
    enabled: canRead,
  });

  if (!canRead) return null;

  const data = query.data;

  return (
    <SectionCard
      title="Inventory Health"
      isLoading={query.isLoading}
      isError={query.isError}
      errorMessage="Failed to load inventory analytics."
    >
      {data && (
        <div style={{ ...statGridStyle, marginBottom: 20 }}>
          <StatCard label="Total On-hand" value={formatNumber(data.totalOnHand)} />
          <StatCard label="Total Available" value={formatNumber(data.totalAvailable)} />
          <StatCard label="Total Reserved" value={formatNumber(data.totalReserved)} />
          <StatCard label="Total Committed" value={formatNumber(data.totalCommitted)} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}>
          <h3 style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>Low Stock</h3>
          {!data || data.lowStockProducts.length === 0 ? (
            <EmptyNote message="No low-stock items." />
          ) : (
            <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Product</th>
                    <th style={thStyle}>Warehouse</th>
                    <th style={thStyle}>Available</th>
                    <th style={thStyle}>Threshold</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lowStockProducts.map((p) => (
                    <tr key={p.id}>
                      <td style={tdStyle}>{p.productName}</td>
                      <td style={{ ...tdStyle, color: '#6b7280' }}>{p.warehouseName}</td>
                      <td style={{ ...tdStyle, color: '#b45309', fontWeight: 600 }}>{formatNumber(p.available)}</td>
                      <td style={{ ...tdStyle, color: '#6b7280' }}>{formatNumber(p.threshold)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ flex: '1 1 320px' }}>
          <h3 style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>Out of Stock</h3>
          {!data || data.outOfStockProducts.length === 0 ? (
            <EmptyNote message="No out-of-stock items." />
          ) : (
            <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Product</th>
                    <th style={thStyle}>Warehouse</th>
                  </tr>
                </thead>
                <tbody>
                  {data.outOfStockProducts.map((p) => (
                    <tr key={p.id}>
                      <td style={tdStyle}>{p.productName}</td>
                      <td style={{ ...tdStyle, color: '#dc2626', fontWeight: 600 }}>{p.warehouseName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <h3 style={{ fontSize: 13, color: '#6b7280', margin: '20px 0 8px' }}>By Warehouse</h3>
      {!data || data.byWarehouse.length === 0 ? (
        <EmptyNote />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Warehouse</th>
                <th style={thStyle}>On-hand</th>
                <th style={thStyle}>Available</th>
                <th style={thStyle}>Reserved</th>
              </tr>
            </thead>
            <tbody>
              {data.byWarehouse.map((w) => (
                <tr key={w.warehouseId}>
                  <td style={tdStyle}>{w.warehouseName}</td>
                  <td style={tdStyle}>{formatNumber(w.onHand)}</td>
                  <td style={tdStyle}>{formatNumber(w.available)}</td>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>{formatNumber(w.reserved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
