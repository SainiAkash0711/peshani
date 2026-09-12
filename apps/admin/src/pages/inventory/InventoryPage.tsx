import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { Button } from '../../components/Button';
import { Pagination } from '../../components/Pagination';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/TableStates';
import { pageHeaderStyle, tableStyle, tdStyle, thStyle, toolbarStyle, inputStyle, cardStyle } from '../../styles';
import { InventoryItem, PaginatedResult, Warehouse } from '../../types/catalog';
import { AdjustStockModal } from './AdjustStockModal';
import { TransferStockModal } from './TransferStockModal';
import { InventoryHistoryModal } from './InventoryHistoryModal';
import { InitializeInventoryModal } from './InitializeInventoryModal';

const PAGE_SIZE = 20;

export function InventoryPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [outOfStock, setOutOfStock] = useState(false);
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);
  const [transferring, setTransferring] = useState<InventoryItem | null>(null);
  const [viewingHistory, setViewingHistory] = useState<InventoryItem | null>(null);
  const [initializing, setInitializing] = useState(false);

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'for-inventory-filter'],
    queryFn: () => apiClient.get<PaginatedResult<Warehouse>>('/warehouses?pageSize=100&status=active'),
  });

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  if (search) params.set('search', search);
  if (warehouseId) params.set('warehouseId', warehouseId);
  if (lowStock) params.set('lowStock', 'true');
  if (outOfStock) params.set('outOfStock', 'true');

  const listQuery = useQuery({
    queryKey: ['inventory', 'list', page, search, warehouseId, lowStock, outOfStock],
    queryFn: () => apiClient.get<PaginatedResult<InventoryItem>>(`/inventory?${params.toString()}`),
  });

  const items = listQuery.data?.items ?? [];
  const pagination = listQuery.data?.pagination;
  const columnCount = 7;

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Inventory</h1>
        <Button onClick={() => setInitializing(true)}>+ Initialize Stock</Button>
      </div>

      <div style={toolbarStyle}>
        <input
          style={inputStyle}
          placeholder="Search by product name or SKU…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select style={inputStyle} value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setPage(1); }}>
          <option value="">All warehouses</option>
          {warehousesQuery.data?.items.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
          <input type="checkbox" checked={lowStock} onChange={(e) => { setLowStock(e.target.checked); setPage(1); }} />
          Low stock only
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
          <input type="checkbox" checked={outOfStock} onChange={(e) => { setOutOfStock(e.target.checked); setPage(1); }} />
          Out of stock only
        </label>
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Product</th>
              <th style={thStyle}>Warehouse</th>
              <th style={thStyle}>On-hand</th>
              <th style={thStyle}>Reserved</th>
              <th style={thStyle}>Available</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && <TableSkeleton columns={columnCount} />}
            {listQuery.isError && <ErrorState columns={columnCount} message="Failed to load inventory. Please try again." />}
            {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
              <EmptyState columns={columnCount} message="No inventory records found." />
            )}
            {items.map((item) => (
              <tr key={item.id}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 500 }}>{item.product.name}</div>
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>{item.variant?.sku ?? item.product.sku}</div>
                </td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{item.warehouse.name}</td>
                <td style={tdStyle}>{item.onHandQuantity}</td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{item.reservedQuantity}</td>
                <td style={tdStyle}>{item.availableQuantity}</td>
                <td style={tdStyle}>
                  {item.isOutOfStock ? (
                    <span style={{ color: '#dc2626', fontSize: 12, fontWeight: 600 }}>Out of stock</span>
                  ) : item.isLowStock ? (
                    <span style={{ color: '#d97706', fontSize: 12, fontWeight: 600 }}>Low stock</span>
                  ) : (
                    <span style={{ color: '#15803d', fontSize: 12, fontWeight: 600 }}>In stock</span>
                  )}
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Button variant="secondary" onClick={() => setAdjusting(item)}>
                      Adjust
                    </Button>
                    <Button variant="secondary" onClick={() => setTransferring(item)}>
                      Transfer
                    </Button>
                    <Button variant="secondary" onClick={() => setViewingHistory(item)}>
                      History
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > 0 && (
        <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
      )}

      {adjusting && <AdjustStockModal item={adjusting} onClose={() => setAdjusting(null)} />}
      {transferring && <TransferStockModal item={transferring} onClose={() => setTransferring(null)} />}
      {viewingHistory && <InventoryHistoryModal item={viewingHistory} onClose={() => setViewingHistory(null)} />}
      {initializing && <InitializeInventoryModal onClose={() => setInitializing(false)} />}
    </div>
  );
}
