import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { Modal } from '../../components/Modal';
import { tableStyle, tdStyle, thStyle } from '../../styles';
import { InventoryItem, InventoryTransactionRecord, PaginatedResult } from '../../types/catalog';

export function InventoryHistoryModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const historyQuery = useQuery({
    queryKey: ['inventory-transactions', item.id],
    queryFn: () => apiClient.get<PaginatedResult<InventoryTransactionRecord>>(`/inventory/${item.id}/transactions?pageSize=50`),
  });

  const transactions = historyQuery.data?.items ?? [];

  return (
    <Modal title={`History: ${item.product.name}`} onClose={onClose} width={640}>
      {historyQuery.isLoading && <p style={{ color: '#9ca3af' }}>Loading…</p>}
      {!historyQuery.isLoading && transactions.length === 0 && <p style={{ color: '#9ca3af' }}>No transactions yet.</p>}
      {transactions.length > 0 && (
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Qty</th>
                <th style={thStyle}>Before → After</th>
                <th style={thStyle}>Reason</th>
                <th style={thStyle}>By</th>
                <th style={thStyle}>When</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td style={tdStyle}>{tx.type}</td>
                  <td style={{ ...tdStyle, color: tx.quantity < 0 ? '#dc2626' : '#15803d' }}>{tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity}</td>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>{tx.previousQuantity} → {tx.newQuantity}</td>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>{tx.reason ?? '—'}</td>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>{tx.performedBy?.email ?? '—'}</td>
                  <td style={{ ...tdStyle, color: '#6b7280', fontSize: 12 }}>{new Date(tx.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
