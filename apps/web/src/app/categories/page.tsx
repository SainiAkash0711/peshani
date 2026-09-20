import Link from 'next/link';
import Image from 'next/image';
import { getCategoryTree } from '../../lib/api';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { isAllowedImageUrl } from '../../lib/safe-image';

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
              {category.image && isAllowedImageUrl(category.image) && (
                <span className="category-tile__image">
                  <Image src={category.image} alt="" fill sizes="(max-width: 640px) 30vw, 160px" />
                </span>
              )}
              {category.name}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
