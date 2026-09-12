import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api-client';
import { EntityOption } from '../lib/promotion-targeting';
import { PaginatedResult } from '../types/catalog';

interface EntityPickerProps {
  label: string;
  resourceUrl: string;
  selected: EntityOption[];
  onChange: (next: EntityOption[]) => void;
  placeholder?: string;
}

/**
 * Searchable "add as tag" multi-select. Types into a text box, debounced
 * search hits the existing paginated admin list endpoint (products /
 * categories / brands), and matches can be added as tags. Selection is fully
 * controlled by the parent - this component holds no ids of its own besides
 * the live search results.
 */
export function EntityPicker({ label, resourceUrl, selected, onChange, placeholder }: EntityPickerProps) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<EntityOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setOptions([]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    const timer = setTimeout(() => {
      apiClient
        .get<PaginatedResult<{ id: string; name: string }>>(
          `${resourceUrl}?search=${encodeURIComponent(trimmed)}&pageSize=10`,
        )
        .then((res) => {
          if (!cancelled) setOptions(res.items.map((item) => ({ id: item.id, name: item.name })));
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
  }, [query, resourceUrl]);

  const selectedIds = new Set(selected.map((s) => s.id));
  const visibleOptions = options.filter((o) => !selectedIds.has(o.id));

  function addOption(opt: EntityOption) {
    onChange([...selected, opt]);
    setQuery('');
    setOptions([]);
  }

  function removeOption(id: string) {
    onChange(selected.filter((s) => s.id !== id));
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>
        {label}
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
          placeholder={placeholder ?? 'Search…'}
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
            {!isLoading && visibleOptions.length === 0 && (
              <div style={{ padding: 8, fontSize: 13, color: '#9ca3af' }}>No matches</div>
            )}
            {!isLoading &&
              visibleOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => addOption(opt)}
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
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {selected.map((s) => (
            <span
              key={s.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: '#eef2ff',
                color: '#3730a3',
                fontSize: 12,
                padding: '3px 8px',
                borderRadius: 999,
              }}
            >
              {s.name}
              <button
                type="button"
                onClick={() => removeOption(s.id)}
                aria-label={`Remove ${s.name}`}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#3730a3', fontSize: 13, padding: 0 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
