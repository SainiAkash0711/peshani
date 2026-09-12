export function TableSkeleton({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex}>
          {Array.from({ length: columns }).map((_, colIndex) => (
            <td key={colIndex} style={{ padding: '10px 12px' }}>
              <div style={{ height: 14, borderRadius: 4, background: '#e5e7eb' }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function EmptyState({ columns, message }: { columns: number; message: string }) {
  return (
    <tr>
      <td colSpan={columns} style={{ padding: '32px 12px', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
        {message}
      </td>
    </tr>
  );
}

export function ErrorState({ columns, message }: { columns: number; message: string }) {
  return (
    <tr>
      <td colSpan={columns} style={{ padding: '32px 12px', textAlign: 'center', color: '#dc2626', fontSize: 14 }}>
        {message}
      </td>
    </tr>
  );
}
