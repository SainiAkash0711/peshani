import { ReactNode } from 'react';
import { cardStyle } from '../../styles';
import { STATUS_COLORS } from '../../lib/analytics-colors';

type Tone = 'default' | 'good' | 'warning' | 'critical';

const TONE_COLOR: Record<Tone, string> = {
  default: '#111827',
  good: STATUS_COLORS.good,
  warning: '#b45309',
  critical: STATUS_COLORS.critical,
};

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}

/** A single KPI figure. Used in flex-wrap rows via `statGridStyle`. */
export function StatCard({ label, value, hint, tone = 'default' }: StatCardProps) {
  return (
    <div style={{ ...cardStyle, flex: '1 1 170px', minWidth: 160, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 21, fontWeight: 700, color: TONE_COLOR[tone], marginTop: 6, lineHeight: 1.2 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
