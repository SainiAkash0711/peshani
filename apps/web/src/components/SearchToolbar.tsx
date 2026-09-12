'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState } from 'react';

interface SearchToolbarProps {
  resultCount: number;
  categories: { slug: string; name: string }[];
  brands: { slug: string; name: string }[];
}

export function SearchToolbar({ resultCount, categories, brands }: SearchToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [minPrice, setMinPrice] = useState(searchParams.get('minPrice') ?? '');
  const [maxPrice, setMaxPrice] = useState(searchParams.get('maxPrice') ?? '');

  function updateParams(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="toolbar">
      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{resultCount} results</span>
      <div className="toolbar__filters">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateParams({ q });
          }}
        >
          <input
            className="field"
            type="search"
            placeholder="Search products…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </form>
        <select
          className="field"
          defaultValue={searchParams.get('categorySlug') ?? ''}
          onChange={(e) => updateParams({ categorySlug: e.target.value })}
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
        <select
          className="field"
          defaultValue={searchParams.get('brandSlug') ?? ''}
          onChange={(e) => updateParams({ brandSlug: e.target.value })}
        >
          <option value="">All brands</option>
          {brands.map((brand) => (
            <option key={brand.slug} value={brand.slug}>
              {brand.name}
            </option>
          ))}
        </select>
        <select
          className="field"
          defaultValue={searchParams.get('availability') ?? ''}
          onChange={(e) => updateParams({ availability: e.target.value })}
        >
          <option value="">Any availability</option>
          <option value="IN_STOCK">In Stock</option>
          <option value="LOW_STOCK">Low Stock</option>
          <option value="OUT_OF_STOCK">Out of Stock</option>
        </select>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateParams({ minPrice, maxPrice });
          }}
          style={{ display: 'flex', gap: 6 }}
        >
          <input
            className="field"
            type="number"
            min="0"
            placeholder="Min price"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            style={{ width: 100 }}
          />
          <input
            className="field"
            type="number"
            min="0"
            placeholder="Max price"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            style={{ width: 100 }}
          />
          <button type="submit" className="btn">
            Apply
          </button>
        </form>
        <select
          className="field"
          defaultValue={searchParams.get('sortBy') ?? 'relevance'}
          onChange={(e) => updateParams({ sortBy: e.target.value })}
        >
          <option value="relevance">Relevance</option>
          <option value="newest">Newest</option>
          <option value="price_asc">Price: Low to High</option>
          <option value="price_desc">Price: High to Low</option>
          <option value="name_asc">Name: A to Z</option>
          <option value="name_desc">Name: Z to A</option>
        </select>
      </div>
    </div>
  );
}
