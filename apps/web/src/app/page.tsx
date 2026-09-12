import Link from 'next/link';
import type { Metadata } from 'next';
import { getCategoryTree, getHomePage, getStoreSettings } from '../lib/api';
import { ProductCard } from '../components/ProductCard';
import { HeroSlider } from '../components/HeroSlider';
import { CategoryMegaMenu } from '../components/CategoryMegaMenu';
import { SITE_URL } from '../lib/site';

// Live catalog/inventory data, not a build-time constant - rendering it at
// request time (rather than prerendering once at build) also means `next
// build` never needs the API reachable, matching every other storefront page.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getStoreSettings();
  return {
    description: settings.storeDescription ?? 'Your trusted online shopping destination',
    alternates: { canonical: SITE_URL },
  };
}

export default async function HomePage() {
  const [settings, home, categoryTree] = await Promise.all([getStoreSettings(), getHomePage(), getCategoryTree()]);
  const currencySymbol = settings.currencySymbol;

  return (
    <main>
      <CategoryMegaMenu categories={categoryTree} />
      {home.slides.length > 0 ? (
        <div className="hero-slider-wrap">
          <HeroSlider slides={home.slides} />
        </div>
      ) : (
        <div className="container">
          <section className="hero">
            <h1>{settings.storeName}</h1>
            <p>{settings.storeDescription ?? 'Your trusted online shopping destination'}</p>
            <Link href="/products" className="btn">
              Shop All Products
            </Link>
          </section>
        </div>
      )}

      <div className="container">
        {home.featuredCategories.length > 0 && (
          <section className="section">
            <div className="section__header">
              <h2>Shop by Category</h2>
              <Link href="/categories">View all</Link>
            </div>
            <div className="category-grid">
              {home.featuredCategories.map((category) => (
                <Link key={category.id} href={`/categories/${category.slug}`} className="category-tile">
                  {category.name}
                </Link>
              ))}
            </div>
          </section>
        )}

        {home.featuredProducts.length > 0 && (
          <section className="section">
            <div className="section__header">
              <h2>Featured Products</h2>
              <Link href="/products?featured=true">View all</Link>
            </div>
            <div className="grid">
              {home.featuredProducts.map((product) => (
                <ProductCard key={product.id} product={product} currencySymbol={currencySymbol} />
              ))}
            </div>
          </section>
        )}

        {home.bestsellers.length > 0 && (
          <section className="section">
            <div className="section__header">
              <h2>Bestsellers</h2>
            </div>
            <div className="grid">
              {home.bestsellers.map((product) => (
                <ProductCard key={product.id} product={product} currencySymbol={currencySymbol} />
              ))}
            </div>
          </section>
        )}

        {home.newArrivals.length > 0 && (
          <section className="section">
            <div className="section__header">
              <h2>New Arrivals</h2>
            </div>
            <div className="grid">
              {home.newArrivals.map((product) => (
                <ProductCard key={product.id} product={product} currencySymbol={currencySymbol} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
