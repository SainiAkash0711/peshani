import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api-client';
import { PaginatedResult } from '../types/catalog';
import { PromotionSummary } from '../types/promotions';

export interface PromotionOption {
  id: string;
  name: string;
}

interface PromotionPickerProps {
  value: PromotionOption | null;
  onChange: (next: PromotionOption | null) => void;
}

/**
 * Single-select searchable combobox for choosing the promotion a coupon
 * belongs to. Feeds off the same GET /promotions?search= endpoint the
 * Promotions list page uses.
 */
export function PromotionPicker({ value, onChange }: PromotionPickerProps) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<PromotionOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    const timer = setTimeout(() => {
      apiClient
        .get<PaginatedResult<PromotionSummary>>(`/promotions?search=${encodeURIComponent(trimmed)}&pageSize=10`)
        .then((res) => {
          if (!cancelled) setOptions(res.items.map((p) => ({ id: p.id, name: p.name })));
        })
        .catch(() => {
          if (!cancelled) setOptions([]);
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  if (value) {
    return (
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>
          Promotion
        </label>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 10px',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontSize: 14,
          }}
        >
          <span>{value.name}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            style={{ border: 'none', background: 'none', color: '#4f46e5', cursor: 'pointer', fontSize: 13 }}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>
        Promotion <span style={{ color: '#dc2626' }}>*</span>
      </label>
      <div style={{ position: 'relative' }}>
        <input
          style={{
            width: '100%',
            padding: '8px 10px',
            fontSize: 14,
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
          placeholder="Search promotions by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim() && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              zIndex: 10,
              background: '#fff',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              marginTop: 2,
              maxHeight: 200,
              overflowY: 'auto',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}
          >
            {isLoading && <div style={{ padding: 8, fontSize: 13, color: '#9ca3af' }}>Searching…</div>}
            {!isLoading && options.length === 0 && (
              <div style={{ padding: 8, fontSize: 13, color: '#9ca3af' }}>No matches</div>
            )}
            {!isLoading &&
              options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onChange(opt);
                    setQuery('');
                    setOptions([]);
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 14,
                  }}
                >
                  {opt.name}
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
