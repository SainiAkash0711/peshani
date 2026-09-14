import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getBlogPostBySlug, getBlogSidebar } from '../../../lib/api';
import { Breadcrumbs } from '../../../components/Breadcrumbs';
import { absoluteUrl } from '../../../lib/site';
import { safeJsonLd } from '../../../lib/json-ld';

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPostBySlug(slug);
  if (!post) return {};

  const description = post.excerpt ?? undefined;
  const imageUrl = post.coverImageUrl ? absoluteUrl(post.coverImageUrl) : undefined;

  return {
    title: post.title,
    description,
    alternates: { canonical: `/blogs/${slug}` },
    openGraph: { title: post.title, description, images: imageUrl ? [imageUrl] : undefined },
    twitter: { card: 'summary_large_image', title: post.title, description, images: imageUrl ? [imageUrl] : undefined },
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const [post, sidebar] = await Promise.all([getBlogPostBySlug(slug), getBlogSidebar()]);
  if (!post) notFound();

  const publishedDate = new Date(post.publishedAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    datePublished: post.publishedAt,
    ...(post.authorName ? { author: { '@type': 'Person', name: post.authorName } } : {}),
    ...(post.coverImageUrl ? { image: [absoluteUrl(post.coverImageUrl)] } : {}),
  };

  return (
    <main className="container">
      <Breadcrumbs items={[{ label: 'Blog', href: '/blogs' }, { label: post.title }]} />

      <div className="blog-layout">
        <article className="blog-detail">
          {post.coverImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.coverImageUrl} alt={post.title} className="blog-detail__cover" />
          )}
          <h1 className="blog-detail__title">{post.title}</h1>
          <div className="blog-detail__meta">
            <time dateTime={post.publishedAt}>{publishedDate}</time>
            {post.authorName && <span> · {post.authorName}</span>}
          </div>
          {post.tags.length > 0 && (
            <div className="blog-list-item__tags" style={{ marginBottom: 20 }}>
              {post.tags.map((t) => (
                <Link key={t} href={`/blogs?tag=${encodeURIComponent(t)}`} className="blog-tag">
                  {t}
                </Link>
              ))}
            </div>
          )}
          {/* Content is HTML from the admin's rich text editor, already
              sanitized server-side (the one enforcement point - see
              sanitizeRichTextHtml in the API) before it's ever persisted, so
              it's trusted here the same way it's trusted coming back from
              any other @Public() storefront endpoint. */}
          {/* eslint-disable-next-line react/no-danger */}
          <div className="blog-detail__content" dangerouslySetInnerHTML={{ __html: post.content }} />
          <Link href="/blogs" className="blog-list-item__readmore" style={{ marginTop: 32, display: 'inline-block' }}>
            ← Back to Blog
          </Link>
        </article>

        <aside className="blog-sidebar">
          {sidebar.recentPosts.length > 0 && (
            <div className="blog-sidebar__section">
              <h3>Recent Posts</h3>
              <ul className="blog-sidebar__recent">
                {sidebar.recentPosts
                  .filter((p) => p.slug !== post.slug)
                  .map((p) => (
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
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(articleJsonLd) }} />
    </main>
  );
}
