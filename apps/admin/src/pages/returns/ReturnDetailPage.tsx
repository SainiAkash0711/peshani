import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../lib/api-client';
import { useAuth } from '../../lib/auth-context';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TextAreaField, SelectField } from '../../components/FormField';
import { NoAccess } from '../../components/NoAccess';
import { cardStyle, pageHeaderStyle, tableStyle, tdStyle, thStyle } from '../../styles';
import { ItemCondition, ItemDisposition, Refund, ReturnRequest } from '../../types/returns';
import { formatEnumLabel, RefundStatusBadge, ReturnStatusBadge } from './badges';

const ITEM_CONDITIONS: ItemCondition[] = ['NEW', 'OPENED', 'USED', 'DAMAGED', 'DEFECTIVE'];
const ITEM_DISPOSITIONS: ItemDisposition[] = ['RESTOCK', 'DAMAGED', 'UNSELLABLE'];

type SimpleActionType = 'UNDER_REVIEW' | 'IN_TRANSIT' | 'RECEIVED';

const SIMPLE_ACTION_COPY: Record<SimpleActionType, { title: string; message: string; confirmLabel: string }> = {
  UNDER_REVIEW: {
    title: 'Mark under review',
    message: 'Mark this return as under review?',
    confirmLabel: 'Mark Under Review',
  },
  IN_TRANSIT: {
    title: 'Mark in transit',
    message: 'Mark this return as in transit back to the warehouse?',
    confirmLabel: 'Mark In Transit',
  },
  RECEIVED: {
    title: 'Mark received',
    message: 'Mark this return as received at the warehouse?',
    confirmLabel: 'Mark Received',
  },
};

interface InspectDraftEntry {
  itemCondition: ItemCondition | '';
  disposition: ItemDisposition | '';
}

function timelineEntries(r: ReturnRequest): { label: string; at: string }[] {
  const entries: { label: string; at: string | null | undefined }[] = [
    { label: 'Requested', at: r.requestedAt },
    { label: 'Approved', at: r.approvedAt },
    { label: 'Rejected', at: r.rejectedAt },
    { label: 'Received', at: r.receivedAt },
    { label: 'Inspected', at: r.inspectedAt },
    { label: 'Refund initiated', at: r.refundInitiatedAt },
    { label: 'Completed', at: r.completedAt },
  ];
  return entries.filter((e): e is { label: string; at: string } => Boolean(e.at));
}

export function ReturnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { hasPermission } = useAuth();

  const canRead = hasPermission('return.read');
  const canUpdate = hasPermission('return.update');
  const canApprove = hasPermission('return.approve');
  const canReject = hasPermission('return.reject');
  const canReceive = hasPermission('return.receive');
  const canInspect = hasPermission('return.inspect');
  const canCreateRefund = hasPermission('refund.create');
  const canManageRefund = hasPermission('refund.manage');

  const [pendingSimpleAction, setPendingSimpleAction] = useState<SimpleActionType | null>(null);
  const [decisionAction, setDecisionAction] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [adminCommentDraft, setAdminCommentDraft] = useState('');
  const [showInspectModal, setShowInspectModal] = useState(false);
  const [inspectDraft, setInspectDraft] = useState<Record<string, InspectDraftEntry>>({});
  const [showRefundConfirm, setShowRefundConfirm] = useState(false);
  const [recoveringRefundId, setRecoveringRefundId] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ['admin-returns', 'detail', id],
    queryFn: () => apiClient.get<ReturnRequest>(`/admin/returns/${id}`),
    enabled: canRead && Boolean(id),
  });

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: ['admin-returns'] });
  }

  const statusMutation = useMutation({
    mutationFn: (status: 'UNDER_REVIEW' | 'IN_TRANSIT') =>
      apiClient.patch<ReturnRequest>(`/admin/returns/${id}/status`, { status }),
    onSuccess: () => {
      toast.show('success', 'Return status updated');
      setPendingSimpleAction(null);
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to update return status'),
  });

  const receivedMutation = useMutation({
    mutationFn: () => apiClient.post<ReturnRequest>(`/admin/returns/${id}/received`),
    onSuccess: () => {
      toast.show('success', 'Return marked as received');
      setPendingSimpleAction(null);
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to mark return as received'),
  });

  const approveMutation = useMutation({
    mutationFn: (adminComment: string) =>
      apiClient.post<ReturnRequest>(`/admin/returns/${id}/approve`, { adminComment: adminComment || undefined }),
    onSuccess: () => {
      toast.show('success', 'Return approved');
      setDecisionAction(null);
      setAdminCommentDraft('');
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to approve return'),
  });

  const rejectMutation = useMutation({
    mutationFn: (adminComment: string) =>
      apiClient.post<ReturnRequest>(`/admin/returns/${id}/reject`, { adminComment: adminComment || undefined }),
    onSuccess: () => {
      toast.show('success', 'Return rejected');
      setDecisionAction(null);
      setAdminCommentDraft('');
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to reject return'),
  });

  const inspectMutation = useMutation({
    mutationFn: (items: { returnItemId: string; itemCondition: ItemCondition; disposition: ItemDisposition }[]) =>
      apiClient.post<ReturnRequest>(`/admin/returns/${id}/inspect`, { items }),
    onSuccess: () => {
      toast.show('success', 'Inspection recorded');
      setShowInspectModal(false);
      setInspectDraft({});
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to record inspection'),
  });

  const refundMutation = useMutation({
    mutationFn: () => apiClient.post<Refund>(`/admin/returns/${id}/refund`),
    onSuccess: () => {
      toast.show('success', 'Refund initiated');
      setShowRefundConfirm(false);
      invalidateAll();
    },
    onError: (err) => toast.show('error', err instanceof ApiError ? err.message : 'Failed to initiate refund'),
  });

  const recoverMutation = useMutation({
    mutationFn: (refundId: string) => apiClient.post<Refund>(`/admin/returns/refunds/${refundId}/recover`),
    onSuccess: () => {
      toast.show('success', 'Refund status checked');
      setRecoveringRefundId(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.show('error', err instanceof ApiError ? err.message : 'Failed to check refund status');
      setRecoveringRefundId(null);
    },
  });

  if (!canRead) {
    return <NoAccess message="You don't have permission to view returns." />;
  }

  if (detailQuery.isLoading) {
    return <div style={{ padding: 24 }}>Loading return…</div>;
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div style={{ padding: 24 }}>
        <p style={{ color: '#dc2626' }}>Failed to load return.</p>
        <Button variant="secondary" onClick={() => navigate('/returns')}>
          Back to Returns
        </Button>
      </div>
    );
  }

  const r = detailQuery.data;
  const customerName = [r.user.firstName, r.user.lastName].filter(Boolean).join(' ').trim() || r.user.email;

  const showMarkUnderReview = r.status === 'REQUESTED' && canUpdate;
  const showMarkInTransit = r.status === 'APPROVED' && canUpdate;
  const showApprove = (r.status === 'REQUESTED' || r.status === 'UNDER_REVIEW') && canApprove;
  const showReject = (r.status === 'REQUESTED' || r.status === 'UNDER_REVIEW') && canReject;
  const showMarkReceived = (r.status === 'APPROVED' || r.status === 'IN_TRANSIT') && canReceive;
  const showInspect = r.status === 'RECEIVED' && canInspect;
  const showInitiateRefund = r.status === 'REFUND_PENDING' && canCreateRefund;

  const isBusy = statusMutation.isPending || receivedMutation.isPending || approveMutation.isPending || rejectMutation.isPending;

  function openInspectModal() {
    const draft: Record<string, InspectDraftEntry> = {};
    for (const item of r.items) {
      draft[item.id] = {
        itemCondition: item.itemCondition ?? '',
        disposition: item.disposition ?? '',
      };
    }
    setInspectDraft(draft);
    setShowInspectModal(true);
  }

  function updateInspectDraft(itemId: string, patch: Partial<InspectDraftEntry>) {
    setInspectDraft((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  }

  const inspectComplete = r.items.every((item) => {
    const entry = inspectDraft[item.id];
    return Boolean(entry && entry.itemCondition && entry.disposition);
  });

  function submitInspection() {
    const items = r.items.map((item) => {
      const entry = inspectDraft[item.id];
      return {
        returnItemId: item.id,
        itemCondition: entry.itemCondition as ItemCondition,
        disposition: entry.disposition as ItemDisposition,
      };
    });
    inspectMutation.mutate(items);
  }

  return (
    <div>
      <div style={pageHeaderStyle}>
        <div>
          <Button variant="secondary" onClick={() => navigate('/returns')} style={{ marginBottom: 10 }}>
            ← Back to Returns
          </Button>
          <h1 style={{ fontSize: 22, margin: 0 }}>Return {r.id}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {showMarkUnderReview && (
            <Button variant="secondary" onClick={() => setPendingSimpleAction('UNDER_REVIEW')}>
              Mark Under Review
            </Button>
          )}
          {showReject && (
            <Button variant="danger" onClick={() => setDecisionAction('REJECT')}>
              Reject
            </Button>
          )}
          {showApprove && (
            <Button variant="primary" onClick={() => setDecisionAction('APPROVE')}>
              Approve
            </Button>
          )}
          {showMarkInTransit && (
            <Button variant="secondary" onClick={() => setPendingSimpleAction('IN_TRANSIT')}>
              Mark In Transit
            </Button>
          )}
          {showMarkReceived && (
            <Button variant="primary" onClick={() => setPendingSimpleAction('RECEIVED')}>
              Mark Received
            </Button>
          )}
          {showInspect && (
            <Button variant="primary" onClick={openInspectModal}>
              Inspect Items
            </Button>
          )}
          {showInitiateRefund && (
            <Button variant="primary" onClick={() => setShowRefundConfirm(true)}>
              Initiate Refund
            </Button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ ...cardStyle, flex: '1 1 260px' }}>
          <h3 style={{ marginTop: 0, fontSize: 14, color: '#6b7280' }}>Order</h3>
          <p style={{ margin: 0, fontSize: 14 }}>
            <span
              style={{ color: '#4f46e5', fontWeight: 500, cursor: 'pointer' }}
              onClick={() => navigate(`/orders/${r.order.orderNumber}`)}
            >
              {r.order.orderNumber}
            </span>
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>Placed {new Date(r.order.placedAt).toLocaleString()}</p>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>Status: {formatEnumLabel(r.order.status)}</p>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>Currency: {r.order.currency}</p>
        </div>

        <div style={{ ...cardStyle, flex: '1 1 260px' }}>
          <h3 style={{ marginTop: 0, fontSize: 14, color: '#6b7280' }}>Customer</h3>
          <p style={{ margin: 0, fontSize: 14 }}>{customerName}</p>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>{r.user.email}</p>
        </div>

        <div style={{ ...cardStyle, flex: '1 1 260px' }}>
          <h3 style={{ marginTop: 0, fontSize: 14, color: '#6b7280' }}>Return</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <ReturnStatusBadge status={r.status} />
          </div>
          <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>Reason: {formatEnumLabel(r.reason)}</p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#9ca3af' }}>ID: {r.id}</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ ...cardStyle, flex: '1 1 260px' }}>
          <h3 style={{ marginTop: 0, fontSize: 14, color: '#6b7280' }}>Comments</h3>
          <p style={{ margin: 0, fontSize: 13, color: '#374151' }}>
            <strong>Customer:</strong> {r.customerComment ? r.customerComment : '—'}
          </p>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: '#374151' }}>
            <strong>Admin:</strong> {r.adminComment ? r.adminComment : '—'}
          </p>
        </div>

        <div style={{ ...cardStyle, flex: '1 1 260px' }}>
          <h3 style={{ marginTop: 0, fontSize: 14, color: '#6b7280' }}>Timeline</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#374151' }}>
            {timelineEntries(r).map((entry) => (
              <li key={entry.label}>
                {entry.label} — {new Date(entry.at).toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto', marginBottom: 16 }}>
        <h3 style={{ margin: '16px 20px 8px', fontSize: 14, color: '#6b7280' }}>Items</h3>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Product</th>
              <th style={thStyle}>Purchased Qty</th>
              <th style={thStyle}>Return Qty</th>
              <th style={thStyle}>Unit Price</th>
              <th style={thStyle}>Refund Amount</th>
              <th style={thStyle}>Condition</th>
              <th style={thStyle}>Disposition</th>
            </tr>
          </thead>
          <tbody>
            {r.items.map((item) => (
              <tr key={item.id}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 500 }}>{item.orderItem.productNameSnapshot}</div>
                  {item.orderItem.variantNameSnapshot && (
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>{item.orderItem.variantNameSnapshot}</div>
                  )}
                  {item.orderItem.skuSnapshot && (
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>SKU: {item.orderItem.skuSnapshot}</div>
                  )}
                </td>
                <td style={tdStyle}>{item.orderItem.quantity}</td>
                <td style={tdStyle}>{item.quantity}</td>
                <td style={tdStyle}>{item.orderItem.unitPrice}</td>
                <td style={tdStyle}>{item.refundAmount}</td>
                <td style={tdStyle}>{item.itemCondition ? formatEnumLabel(item.itemCondition) : '—'}</td>
                <td style={tdStyle}>
                  {item.disposition ? (
                    <span style={{ fontWeight: 600, color: item.disposition === 'RESTOCK' ? '#15803d' : '#dc2626' }}>
                      {formatEnumLabel(item.disposition)}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 14, color: '#6b7280' }}>Evidence</h3>
        {r.evidence.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>No evidence submitted.</p>
        ) : (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {r.evidence.map((ev) => (
              <a key={ev.id} href={ev.url} target="_blank" rel="noreferrer" title={ev.originalFilename ?? undefined}>
                <img
                  src={ev.url}
                  alt={ev.originalFilename ?? 'Return evidence'}
                  style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 6, border: '1px solid #e5e7eb' }}
                />
              </a>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <h3 style={{ margin: '16px 20px 8px', fontSize: 14, color: '#6b7280' }}>Refunds</h3>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Amount</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Provider</th>
              <th style={thStyle}>Provider Refund ID</th>
              <th style={thStyle}>Failure Reason</th>
              <th style={thStyle}>Timestamps</th>
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {r.refunds.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#9ca3af' }}>
                  No refunds yet.
                </td>
              </tr>
            )}
            {r.refunds.map((refund) => {
              const canRecover = canManageRefund && (refund.status === 'UNKNOWN' || refund.status === 'PROCESSING');
              const isRecoveringThis = recoverMutation.isPending && recoveringRefundId === refund.id;
              return (
                <tr key={refund.id}>
                  <td style={tdStyle}>
                    {refund.amount} {refund.currency}
                  </td>
                  <td style={tdStyle}>
                    <RefundStatusBadge status={refund.status} />
                  </td>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>{refund.provider ?? '—'}</td>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>{refund.providerRefundId ?? '—'}</td>
                  <td style={{ ...tdStyle, color: '#dc2626' }}>{refund.failureReason ?? '—'}</td>
                  <td style={{ ...tdStyle, color: '#6b7280', fontSize: 12 }}>
                    <div>Created {new Date(refund.createdAt).toLocaleString()}</div>
                    {refund.initiatedAt && <div>Initiated {new Date(refund.initiatedAt).toLocaleString()}</div>}
                    {refund.succeededAt && <div>Succeeded {new Date(refund.succeededAt).toLocaleString()}</div>}
                    {refund.failedAt && <div>Failed {new Date(refund.failedAt).toLocaleString()}</div>}
                  </td>
                  <td style={tdStyle}>
                    {canRecover && (
                      <Button
                        variant="secondary"
                        disabled={isRecoveringThis}
                        onClick={() => {
                          setRecoveringRefundId(refund.id);
                          recoverMutation.mutate(refund.id);
                        }}
                      >
                        {isRecoveringThis ? 'Checking…' : 'Check Status'}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pendingSimpleAction && (
        <ConfirmDialog
          title={SIMPLE_ACTION_COPY[pendingSimpleAction].title}
          message={SIMPLE_ACTION_COPY[pendingSimpleAction].message}
          confirmLabel={SIMPLE_ACTION_COPY[pendingSimpleAction].confirmLabel}
          isBusy={isBusy}
          onCancel={() => setPendingSimpleAction(null)}
          onConfirm={() => {
            if (pendingSimpleAction === 'RECEIVED') {
              receivedMutation.mutate();
            } else {
              statusMutation.mutate(pendingSimpleAction);
            }
          }}
        />
      )}

      {decisionAction && (
        <Modal
          title={decisionAction === 'APPROVE' ? 'Approve return' : 'Reject return'}
          onClose={() => { setDecisionAction(null); setAdminCommentDraft(''); }}
          width={420}
        >
          <TextAreaField
            label="Admin comment (optional)"
            value={adminCommentDraft}
            onChange={(e) => setAdminCommentDraft(e.target.value)}
            placeholder="Note visible in the return timeline…"
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <Button variant="secondary" onClick={() => { setDecisionAction(null); setAdminCommentDraft(''); }} disabled={isBusy}>
              Cancel
            </Button>
            <Button
              variant={decisionAction === 'REJECT' ? 'danger' : 'primary'}
              disabled={isBusy}
              onClick={() => {
                if (decisionAction === 'APPROVE') {
                  approveMutation.mutate(adminCommentDraft);
                } else {
                  rejectMutation.mutate(adminCommentDraft);
                }
              }}
            >
              {isBusy ? 'Please wait…' : decisionAction === 'APPROVE' ? 'Approve' : 'Reject'}
            </Button>
          </div>
        </Modal>
      )}

      {showInspectModal && (
        <Modal title="Inspect returned items" onClose={() => setShowInspectModal(false)} width={640}>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: '#6b7280' }}>
            Every item must have a condition and disposition before this can be submitted. Choosing{' '}
            <strong>Restock</strong> returns the item to sellable inventory; <strong>Damaged</strong> and{' '}
            <strong>Unsellable</strong> do not affect available stock.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {r.items.map((item) => {
              const entry = inspectDraft[item.id] ?? { itemCondition: '', disposition: '' };
              return (
                <div key={item.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 2 }}>{item.orderItem.productNameSnapshot}</div>
                  {item.orderItem.variantNameSnapshot && (
                    <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>{item.orderItem.variantNameSnapshot}</div>
                  )}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 200px' }}>
                      <SelectField
                        label="Condition"
                        required
                        value={entry.itemCondition}
                        onChange={(e) => updateInspectDraft(item.id, { itemCondition: e.target.value as ItemCondition })}
                      >
                        <option value="">Select condition…</option>
                        {ITEM_CONDITIONS.map((c) => (
                          <option key={c} value={c}>
                            {formatEnumLabel(c)}
                          </option>
                        ))}
                      </SelectField>
                    </div>
                    <div style={{ flex: '1 1 200px' }}>
                      <SelectField
                        label="Disposition"
                        required
                        value={entry.disposition}
                        onChange={(e) => updateInspectDraft(item.id, { disposition: e.target.value as ItemDisposition })}
                      >
                        <option value="">Select disposition…</option>
                        {ITEM_DISPOSITIONS.map((d) => (
                          <option key={d} value={d}>
                            {formatEnumLabel(d)}
                          </option>
                        ))}
                      </SelectField>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <Button variant="secondary" onClick={() => setShowInspectModal(false)} disabled={inspectMutation.isPending}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!inspectComplete || inspectMutation.isPending} onClick={submitInspection}>
              {inspectMutation.isPending ? 'Submitting…' : 'Submit Inspection'}
            </Button>
          </div>
        </Modal>
      )}

      {showRefundConfirm && (
        <ConfirmDialog
          title="Initiate refund"
          message="This will initiate a real refund to the customer's original payment method for the server-calculated amount. This cannot be undone. Continue?"
          confirmLabel="Initiate Refund"
          danger
          isBusy={refundMutation.isPending}
          onConfirm={() => refundMutation.mutate()}
          onCancel={() => setShowRefundConfirm(false)}
        />
      )}
    </div>
  );
}
