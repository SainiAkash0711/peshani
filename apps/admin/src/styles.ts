import type { CSSProperties } from 'react';

export const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
export const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  borderBottom: '2px solid #e5e7eb',
  color: '#6b7280',
  fontWeight: 600,
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};
export const tdStyle: CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #f1f5f9' };
export const cardStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: 20,
};
export const pageHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 20,
};
export const toolbarStyle: CSSProperties = { display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' };
export const inputStyle: CSSProperties = {
  padding: '8px 10px',
  fontSize: 14,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  minWidth: 220,
};
export const statGridStyle: CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 4 };
export const sectionStyle: CSSProperties = { ...cardStyle, marginBottom: 20 };
