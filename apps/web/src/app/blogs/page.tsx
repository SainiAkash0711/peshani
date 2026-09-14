import Link from 'next/link';
import { getBlogPosts, getBlogSidebar } from '../../lib/api';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { Pagination } from '../../components/Pagination';

export const metadata = { title: 'Blog' };
export const dynamic = 'force-dynamic';

interface BlogPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const query = await searchParams;
  const page = Number(query.page ?? '1');
  const tag = query.tag;

  const [posts, sidebar] = await Promise.all([getBlogPosts({ page, tag }), getBlogSidebar()]);

  return (
    <main className="container">
      <Breadcrumbs items={[{ label: 'Blog' }]} />
      <h1 style={{ marginBottom: 8 }}>Blog</h1>
      {tag && (
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 24 }}>
          Showing posts tagged “{tag}” - <Link href="/blogs">clear filter</Link>
        </p>
      )}

      <div className="blog-layout">
        <div className="blog-list">
          {posts.items.length === 0 ? (
            <div className="empty-state">No blog posts published yet.</div>
          ) : (
            posts.items.map((post) => (
              <article key={post.id} className="blog-list-item">
                {post.coverImageUrl && (
                  <Link href={`/blogs/${post.slug}`} className="blog-list-item__image">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={post.coverImageUrl} alt={post.title} />
                  </Link>
                )}
                <div className="blog-list-item__body">
                  <time className="blog-list-item__date" dateTime={post.publishedAt}>
                    {new Date(post.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </time>
                  <h2 className="blog-list-item__title">
                    <Link href={`/blogs/${post.slug}`}>{post.title}</Link>
                  </h2>
                  {post.tags.length > 0 && (
                    <div className="blog-list-item__tags">
                      {post.tags.map((t) => (
                        <Link key={t} href={`/blogs?tag=${encodeURIComponent(t)}`} className="blog-tag">
                          {t}
                        </Link>
                      ))}
                    </div>
                  )}
                  {post.authorName && <p className="blog-list-item__author">— {post.authorName}</p>}
                  {post.excerpt && <p className="blog-list-item__excerpt">{post.excerpt}</p>}
                  <Link href={`/blogs/${post.slug}`} className="blog-list-item__readmore">
                    Read more →
                  </Link>
                </div>
              </article>
            ))
          )}
          <Pagination pagination={posts.pagination} basePath="/blogs" currentParams={query} />
        </div>

        <aside className="blog-sidebar">
          {sidebar.recentPosts.length > 0 && (
            <div className="blog-sidebar__section">
              <h3>Recent Posts</h3>
              <ul className="blog-sidebar__recent">
                {sidebar.recentPosts.map((p) => (
                  <li key={p.id}>
                    <Link href={`/blogs/${p.slug}`}>{p.title}</Link>
                    <span className="blog-sidebar__date">
                      {new Date(p.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {sidebar.tags.length > 0 && (
            <div className="blog-sidebar__section">
              <h3>Tags</h3>
              <div className="blog-sidebar__tags">
                {sidebar.tags.map((t) => (
                  <Link key={t} href={`/blogs?tag=${encodeURIComponent(t)}`} className="blog-tag">
                    {t}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
