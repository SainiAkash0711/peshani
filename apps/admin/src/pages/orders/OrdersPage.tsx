import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { Pagination } from '../../components/Pagination';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/TableStates';
import { pageHeaderStyle, tableStyle, tdStyle, thStyle, toolbarStyle, inputStyle, cardStyle } from '../../styles';
import { PaginatedResult } from '../../types/catalog';
import { OrderListItem, OrderStatus, PaymentStatus } from '../../types/orders';
import { OrderStatusBadge, PaymentStatusBadge } from './badges';

const PAGE_SIZE = 20;

const ORDER_STATUSES: OrderStatus[] = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PROCESSING',
  'PACKED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
];

const PAYMENT_STATUSES: PaymentStatus[] = ['CREATED', 'PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED'];

export function OrdersPage() {
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | OrderStatus>('');
  const [paymentStatus, setPaymentStatus] = useState<'' | PaymentStatus>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (paymentStatus) params.set('paymentStatus', paymentStatus);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  const listQuery = useQuery({
    queryKey: ['orders', 'list', page, search, status, paymentStatus, dateFrom, dateTo],
    queryFn: () => apiClient.get<PaginatedResult<OrderListItem>>(`/admin/orders?${params.toString()}`),
  });

  const items = listQuery.data?.items ?? [];
  const pagination = listQuery.data?.pagination;
  const columnCount = 7;

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Orders</h1>
      </div>

      <div style={toolbarStyle}>
        <input
          style={inputStyle}
          placeholder="Search by order number or email…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select
          style={inputStyle}
          value={status}
          onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}
        >
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          style={inputStyle}
          value={paymentStatus}
          onChange={(e) => { setPaymentStatus(e.target.value as typeof paymentStatus); setPage(1); }}
        >
          <option value="">All payment statuses</option>
          {PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          style={inputStyle}
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
        />
        <input
          style={inputStyle}
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
        />
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Order #</th>
              <th style={thStyle}>Customer</th>
              <th style={thStyle}>Placed</th>
              <th style={thStyle}>Payment</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Shipping</th>
              <th style={thStyle}>Total</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && <TableSkeleton columns={columnCount} />}
            {listQuery.isError && <ErrorState columns={columnCount} message="Failed to load orders. Please try again." />}
            {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
              <EmptyState columns={columnCount} message="No orders found." />
            )}
            {items.map((order) => (
              <tr
                key={order.orderNumber}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/orders/${order.orderNumber}`)}
              >
                <td style={{ ...tdStyle, fontWeight: 500 }}>{order.orderNumber}</td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{order.customerEmail}</td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{new Date(order.createdAt).toLocaleString()}</td>
                <td style={tdStyle}>
                  <PaymentStatusBadge status={order.paymentStatus} />
                </td>
                <td style={tdStyle}>
                  <OrderStatusBadge status={order.status} />
                </td>
                <td style={{ ...tdStyle, color: '#6b7280' }}>{order.shippingMethodName ?? '—'}</td>
                <td style={tdStyle}>₹{order.totalAmount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > 0 && (
        <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
      )}
    </div>
  );
}
