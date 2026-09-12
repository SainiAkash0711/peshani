import Link from 'next/link';
import type { PaginationMeta } from '../types/catalog';

interface PaginationProps {
  pagination: PaginationMeta;
  basePath: string;
  currentParams: Record<string, string | undefined>;
}

export function Pagination({ pagination, basePath, currentParams }: PaginationProps) {
  if (pagination.totalPages <= 1) return null;

  const hrefForPage = (page: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(currentParams)) {
      if (value) search.set(key, value);
    }
    search.set('page', String(page));
    return `${basePath}?${search.toString()}`;
  };

  const pages = Array.from({ length: pagination.totalPages }, (_, i) => i + 1);

  return (
    <nav className="pagination" aria-label="Pagination">
      {pagination.page > 1 && <Link href={hrefForPage(pagination.page - 1)}>Prev</Link>}
      {pages.map((page) =>
        page === pagination.page ? (
          <span key={page} className="is-current">
            {page}
          </span>
        ) : (
          <Link key={page} href={hrefForPage(page)}>
            {page}
          </Link>
        ),
      )}
      {pagination.page < pagination.totalPages && <Link href={hrefForPage(pagination.page + 1)}>Next</Link>}
    </nav>
  );
}
