'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState } from 'react';

export function ProductToolbar({ resultCount }: { resultCount: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="toolbar">
      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{resultCount} products</span>
      <div className="toolbar__filters">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateParam('search', search);
          }}
        >
          <input
            className="field"
            type="search"
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
        <select
          className="field"
          defaultValue={`${searchParams.get('sortBy') ?? 'createdAt'}:${searchParams.get('sortOrder') ?? 'desc'}`}
          onChange={(e) => {
            const [sortBy, sortOrder] = e.target.value.split(':');
            const params = new URLSearchParams(searchParams.toString());
            params.set('sortBy', sortBy);
            params.set('sortOrder', sortOrder);
            params.delete('page');
            router.push(`${pathname}?${params.toString()}`);
          }}
        >
          <option value="createdAt:desc">Newest</option>
          <option value="price:asc">Price: Low to High</option>
          <option value="price:desc">Price: High to Low</option>
          <option value="name:asc">Name: A to Z</option>
        </select>
      </div>
    </div>
  );
}
