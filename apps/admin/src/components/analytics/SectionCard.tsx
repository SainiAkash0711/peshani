import { ReactNode } from 'react';
import { sectionStyle } from '../../styles';
import { formatRangeCaption } from '../../lib/analytics-format';

interface SectionCardProps {
  title: string;
  /** Present for every date-filtered endpoint's `range` block - rendered as a caption so the
   * admin always sees exactly what window is being reported. Omit for snapshot endpoints
   * (inventory, reconciliation) that carry no `range`. */
  range?: { from: string; to: string; timezone: string } | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Shared shell for one analytics dashboard section: title + optional range
 * caption + optional actions (export button, granularity toggle, ...) in the
 * header, then per-section loading/error/content - each section's own query
 * fails or loads independently without affecting the rest of the page.
 */
export function SectionCard({ title, range, isLoading, isError, errorMessage, actions, children }: SectionCardProps) {
  return (
    <div style={sectionStyle}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 14,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
          {range && (
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{formatRangeCaption(range)}</div>
          )}
        </div>
        {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
      </div>

      {isLoading && (
        <div style={{ padding: '28px 0', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>Loading…</div>
      )}
      {isError && !isLoading && (
        <div style={{ padding: '28px 0', textAlign: 'center', color: '#dc2626', fontSize: 14 }}>
          {errorMessage ?? 'Failed to load this section. Please try again.'}
        </div>
      )}
      {!isLoading && !isError && children}
    </div>
  );
}

/** Inline empty-state note for a chart or table body with no data for the selected period. */
export function EmptyNote({ message = 'No data for this period.' }: { message?: string }) {
  return <p style={{ margin: '20px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>{message}</p>;
}
