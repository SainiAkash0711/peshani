import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useAuth } from '../../../lib/auth-context';
import { SectionCard } from '../../../components/analytics/SectionCard';
import { cardStyle } from '../../../styles';
import { formatNumber } from '../../../lib/analytics-format';
import { STATUS_COLORS } from '../../../lib/analytics-colors';
import { ReconciliationResponse } from '../../../types/analytics';

const DIAGNOSTIC_ROWS: { key: keyof ReconciliationResponse; label: string; caption: string }[] = [
  {
    key: 'capturedPaymentsWithoutConfirmedOrder',
    label: 'Captured Payments Without Confirmed Order',
    caption: 'A payment was captured but the matching order never reached CONFIRMED.',
  },
  {
    key: 'confirmedOrdersWithoutCapturedPayment',
    label: 'Confirmed Orders Without Captured Payment',
    caption: 'A rare, already-audited edge case (inventory expiring mid-confirmation) - a small nonzero count is a manual-review signal, not evidence of a bug.',
  },
  {
    key: 'refundsExceedingRefundableBalance',
    label: 'Refunds Exceeding Refundable Balance',
    caption: 'A refund was recorded for more than the order had left to refund.',
  },
  {
    key: 'unknownRefundsRequiringReconciliation',
    label: 'Unknown Refunds Requiring Reconciliation',
    caption: 'Refunds stuck in an UNKNOWN provider state - see the Refunds section above.',
  },
];

/** A diagnostic snapshot (no date range), not a KPI - 0 reads as healthy, nonzero as a
 * needs-manual-review signal rather than an alarm. */
export function ReconciliationSection() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('analytics.read');

  const query = useQuery({
    queryKey: ['analytics', 'reconciliation'],
    queryFn: () => apiClient.get<ReconciliationResponse>('/admin/analytics/reconciliation'),
    enabled: canRead,
  });

  if (!canRead) return null;

  const data = query.data;

  return (
    <SectionCard
      title="System Health / Reconciliation"
      isLoading={query.isLoading}
      isError={query.isError}
      errorMessage="Failed to load reconciliation diagnostics."
    >
      {data && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {DIAGNOSTIC_ROWS.map((row) => {
            const value = data[row.key];
            const isHealthy = value === 0;
            return (
              <div key={row.key} style={{ ...cardStyle, flex: '1 1 220px', minWidth: 220, padding: '14px 16px' }}>
                <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  {row.label}
                </div>
                <div
                  style={{
                    fontSize: 21,
                    fontWeight: 700,
                    color: isHealthy ? STATUS_COLORS.good : STATUS_COLORS.critical,
                    marginTop: 6,
                  }}
                >
                  {formatNumber(value)}
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{row.caption}</div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
