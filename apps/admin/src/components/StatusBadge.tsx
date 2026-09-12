export function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: isActive ? '#dcfce7' : '#f3f4f6',
        color: isActive ? '#15803d' : '#6b7280',
      }}
    >
      {isActive ? 'Active' : 'Inactive'}
    </span>
  );
}
