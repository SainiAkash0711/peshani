import Link from 'next/link';
import { getCategoryTree } from '../../lib/api';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { CategoryTile } from '../../components/CategoryTile';

export const metadata = { title: 'Categories' };
export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const categories = await getCategoryTree();

  return (
    <main className="container">
      <Breadcrumbs items={[{ label: 'Categories' }]} />
      <header className="page-intro">
        <p className="page-intro__eyebrow">Browse the store</p>
        <h1>Shop by Category</h1>
        <p>Explore every collection — from everyday essentials to handmade pieces.</p>
      </header>
      {categories.length === 0 ? (
        <div className="empty-state empty-state--rich">
          <p>No categories available yet.</p>
          <Link href="/products" className="btn">
            Browse all products
          </Link>
        </div>
      ) : (
        <div className="cat-grid">
          {categories.map((category, index) => (
            <CategoryTile
              key={category.id}
              slug={category.slug}
              name={category.name}
              image={category.image}
              description={category.description}
              subcategoryCount={category.children.length}
              index={index}
            />
          ))}
        </div>
      )}
    </main>
  );
}
