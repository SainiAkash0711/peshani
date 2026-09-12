import Link from 'next/link';
import { getBrands } from '../../lib/api';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { Pagination } from '../../components/Pagination';

interface BrandsPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export const metadata = { title: 'Brands' };

export default async function BrandsPage({ searchParams }: BrandsPageProps) {
  const params = await searchParams;
  const result = await getBrands({ page: Number(params.page ?? '1'), search: params.search });

  return (
    <main className="container">
      <Breadcrumbs items={[{ label: 'Brands' }]} />
      <h1 style={{ marginBottom: 24 }}>Brands</h1>
      {result.items.length === 0 ? (
        <div className="empty-state">No brands available yet.</div>
      ) : (
        <>
          <div className="brand-strip">
            {result.items.map((brand) => (
              <Link key={brand.id} href={`/brands/${brand.slug}`} className="brand-chip">
                {brand.name}
              </Link>
            ))}
          </div>
          <Pagination pagination={result.pagination} basePath="/brands" currentParams={params} />
        </>
      )}
    </main>
  );
}
