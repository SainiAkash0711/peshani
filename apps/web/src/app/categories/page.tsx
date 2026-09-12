import Link from 'next/link';
import { getCategoryTree } from '../../lib/api';
import { Breadcrumbs } from '../../components/Breadcrumbs';

export const metadata = { title: 'Categories' };
export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const categories = await getCategoryTree();

  return (
    <main className="container">
      <Breadcrumbs items={[{ label: 'Categories' }]} />
      <h1 style={{ marginBottom: 24 }}>Categories</h1>
      {categories.length === 0 ? (
        <div className="empty-state">No categories available yet.</div>
      ) : (
        <div className="category-grid">
          {categories.map((category) => (
            <Link key={category.id} href={`/categories/${category.slug}`} className="category-tile">
              {category.name}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
