import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { useAuth } from '../../lib/auth-context';
import { Pagination } from '../../components/Pagination';
import { NoAccess } from '../../components/NoAccess';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/TableStates';
import { pageHeaderStyle, tableStyle, tdStyle, thStyle, toolbarStyle, inputStyle, cardStyle } from '../../styles';
import { AdminReturnsListResult, ReturnReason, ReturnRequest, ReturnStatus } from '../../types/returns';
import { formatEnumLabel, ReturnStatusBadge, RefundStatusBadge } from './badges';

const PAGE_SIZE = 20;

const RETURN_STATUSES: ReturnStatus[] = [
  'REQUESTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'IN_TRANSIT',
  'RECEIVED',
  'REFUND_PENDING',
  'REFUND_INITIATED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'COMPLETED',
];

const RETURN_REASONS: ReturnReason[] = [
  'DAMAGED',
  'DEFECTIVE',
  'WRONG_ITEM',
  'WRONG_SIZE',
  'NOT_AS_DESCRIBED',
  'CHANGED_MIND',
  'OTHER',
];

function customerLabel(returnRequest: ReturnRequest): { name: string; email: string } {
  const { user } = returnRequest;
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return { name: fullName || user.email, email: user.email };
}

function latestRefund(returnRequest: ReturnRequest) {
  if (returnRequest.refunds.length === 0) return null;
  return [...returnRequest.refunds].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
}

export function ReturnsPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canRead = hasPermission('return.read');

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'' | ReturnStatus>('');
  const [reason, setReason] = useState<'' | ReturnReason>('');
  const [orderNumber, setOrderNumber] = useState('');
  const [userId, setUserId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  if (status) params.set('status', status);
  if (reason) params.set('reason', reason);
  if (orderNumber.trim()) params.set('orderNumber', orderNumber.trim());
  if (userId.trim()) params.set('userId', userId.trim());
  if (fromDate) params.set('fromDate', fromDate);
  if (toDate) params.set('toDate', toDate);

  const listQuery = useQuery({
    queryKey: ['admin-returns', 'list', page, status, reason, orderNumber, userId, fromDate, toDate],
    queryFn: () => apiClient.get<AdminReturnsListResult>(`/admin/returns?${params.toString()}`),
    enabled: canRead,
  });

  if (!canRead) {
    return <NoAccess message="You don't have permission to view returns." />;
  }

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const pageSize = listQuery.data?.pageSize ?? PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const columnCount = 7;

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Returns</h1>
      </div>

      <div style={toolbarStyle}>
        <select
          style={inputStyle}
          value={status}
          onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}
        >
          <option value="">All statuses</option>
          {RETURN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {formatEnumLabel(s)}
            </option>
          ))}
        </select>
        <select
          style={inputStyle}
          value={reason}
          onChange={(e) => { setReason(e.target.value as typeof reason); setPage(1); }}
        >
          <option value="">All reasons</option>
          {RETURN_REASONS.map((r) => (
            <option key={r} value={r}>
              {formatEnumLabel(r)}
            </option>
          ))}
        </select>
        <input
          style={inputStyle}
          placeholder="Order number…"
          value={orderNumber}
          onChange={(e) => { setOrderNumber(e.target.value); setPage(1); }}
        />
        <input
          style={inputStyle}
          placeholder="Customer user ID…"
          value={userId}
          onChange={(e) => { setUserId(e.target.value); setPage(1); }}
        />
        <input style={inputStyle} type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} />
        <input style={inputStyle} type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} />
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Order</th>
              <th style={thStyle}>Customer</th>
              <th style={thStyle}>Reason</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Refund Status</th>
              <th style={thStyle}>Refund Amount</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && <TableSkeleton columns={columnCount} />}
            {listQuery.isError && <ErrorState columns={columnCount} message="Failed to load returns. Please try again." />}
            {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
              <EmptyState columns={columnCount} message="No returns found." />
            )}
            {items.map((returnRequest) => {
              const customer = customerLabel(returnRequest);
              const refund = latestRefund(returnRequest);
              return (
                <tr
                  key={returnRequest.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/returns/${returnRequest.id}`)}
                >
                  <td style={{ ...tdStyle, color: '#6b7280' }}>{new Date(returnRequest.requestedAt).toLocaleString()}</td>
                  <td style={tdStyle}>
                    <span
                      style={{ color: '#4f46e5', fontWeight: 500, cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); navigate(`/orders/${returnRequest.order.orderNumber}`); }}
                    >
                      {returnRequest.order.orderNumber}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <div>{customer.name}</div>
                    {customer.name !== customer.email && (
                      <div style={{ fontSize: 12, color: '#9ca3af' }}>{customer.email}</div>
                    )}
                  </td>
                  <td style={tdStyle}>{formatEnumLabel(returnRequest.reason)}</td>
                  <td style={tdStyle}>
                    <ReturnStatusBadge status={returnRequest.status} />
                  </td>
                  <td style={tdStyle}>{refund ? <RefundStatusBadge status={refund.status} /> : '—'}</td>
                  <td style={tdStyle}>{refund ? `${refund.amount} ${refund.currency}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > 0 && <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />}
    </div>
  );
}
