'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PaginatedResult } from '../types/catalog';
import type { PublicReview, ReviewSummary } from '../types/review';
import { useToast } from '../lib/toast-context';
import { WriteReview } from './WriteReview';

const PAGE_SIZE = 10;

function Stars({ rating }: { rating: number }) {
  return (
    <span style={{ color: '#f59e0b', letterSpacing: 1 }} aria-label={`${rating} out of 5 stars`}>
      {'★'.repeat(rating)}
      <span style={{ color: '#e5e7eb' }}>{'★'.repeat(5 - rating)}</span>
    </span>
  );
}

function RatingSummary({ summary }: { summary: ReviewSummary }) {
  const rows: (keyof ReviewSummary['distribution'])[] = ['5', '4', '3', '2', '1'];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start', marginBottom: 24 }}>
      <div style={{ textAlign: 'center', minWidth: 120 }}>
        <div style={{ fontSize: '2rem', fontWeight: 700 }}>{summary.averageRating.toFixed(1)}</div>
        <Stars rating={Math.round(summary.averageRating)} />
        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
          {summary.totalReviews} review{summary.totalReviews === 1 ? '' : 's'}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 200, maxWidth: 320 }}>
        {rows.map((star) => {
          const count = summary.distribution[star] ?? 0;
          const pct = summary.totalReviews > 0 ? Math.round((count / summary.totalReviews) * 100) : 0;
          return (
            <div key={star} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', marginBottom: 4 }}>
              <span style={{ width: 32 }}>{star}★</span>
              <div style={{ flex: 1, height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: '#f59e0b' }} />
              </div>
              <span style={{ width: 28, textAlign: 'right', color: 'var(--color-text-muted)' }}>{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReviewCard({ review }: { review: PublicReview }) {
  const { show } = useToast();
  const [helpfulCount, setHelpfulCount] = useState(review.helpfulCount);
  const [voted, setVoted] = useState(false);
  const [isVoting, setIsVoting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [isReporting, setIsReporting] = useState(false);

  async function toggleHelpful() {
    setIsVoting(true);
    try {
      const res = await fetch(`/api/reviews/${review.id}/helpful`, { method: voted ? 'DELETE' : 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        show(data?.message ?? 'Could not record your vote. Please try again.', 'error');
        return;
      }
      setHelpfulCount(data.helpfulCount);
      setVoted(data.votedByCurrentUser);
    } catch {
      show('Could not reach the review service. Please try again.', 'error');
    } finally {
      setIsVoting(false);
    }
  }

  async function submitReport() {
    if (!reportReason.trim()) {
      show('Please enter a reason', 'error');
      return;
    }
    setIsReporting(true);
    try {
      const res = await fetch(`/api/reviews/${review.id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reportReason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        show(data.message ?? 'Could not report this review. Please try again.', 'error');
        return;
      }
      show('Thanks - this review has been reported for moderation');
      setReportOpen(false);
      setReportReason('');
    } catch {
      show('Could not reach the review service. Please try again.', 'error');
    } finally {
      setIsReporting(false);
    }
  }

  return (
    <div style={{ borderBottom: '1px solid #e5e7eb', padding: '16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>{review.reviewerDisplayName}</strong>
        {review.verifiedPurchase && (
          <span className="badge badge--in-stock" style={{ fontSize: '0.7rem' }}>
            Verified Purchase
          </span>
        )}
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
          {new Date(review.createdAt).toLocaleDateString()}
        </span>
      </div>
      <div style={{ margin: '6px 0' }}>
        <Stars rating={review.rating} />
      </div>
      {review.title && <div style={{ fontWeight: 600, marginBottom: 4 }}>{review.title}</div>}
      <p style={{ margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>{review.body}</p>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: '0.85rem' }}>
        <button
          type="button"
          className="btn btn--outline"
          onClick={() => void toggleHelpful()}
          disabled={isVoting}
          style={{ padding: '4px 10px', fontSize: '0.8rem' }}
        >
          {voted ? '✓ Helpful' : 'Helpful'} ({helpfulCount})
        </button>
        {!reportOpen ? (
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', font: 'inherit', padding: 0 }}
          >
            Report
          </button>
        ) : null}
      </div>
      {reportOpen && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            placeholder="Why are you reporting this review?"
            style={{ flex: 1, minWidth: 200, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6 }}
          />
          <button type="button" className="btn" onClick={() => void submitReport()} disabled={isReporting} style={{ padding: '6px 12px' }}>
            {isReporting ? 'Submitting…' : 'Submit'}
          </button>
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => { setReportOpen(false); setReportReason(''); }}
            disabled={isReporting}
            style={{ padding: '6px 12px' }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export function ProductReviews({ productId }: { productId: string }) {
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [reviews, setReviews] = useState<PaginatedResult<PublicReview> | null>(null);
  const [page, setPage] = useState(1);
  const [ratingFilter, setRatingFilter] = useState<'' | string>('');
  const [sortBy, setSortBy] = useState<'createdAt' | 'rating'>('createdAt');
  const [isLoading, setIsLoading] = useState(true);

  const loadReviews = useCallback(async () => {
    setIsLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    params.set('sortBy', sortBy);
    params.set('sortOrder', 'desc');
    if (ratingFilter) params.set('rating', ratingFilter);
    try {
      const res = await fetch(`/api/products/${productId}/reviews?${params.toString()}`, { cache: 'no-store' });
      if (res.ok) setReviews(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, [productId, page, sortBy, ratingFilter]);

  useEffect(() => {
    fetch(`/api/products/${productId}/reviews/summary`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [productId]);

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  const items = reviews?.items ?? [];
  const pagination = reviews?.pagination;

  return (
    <section style={{ marginTop: 48 }}>
      <h2>Ratings &amp; Reviews</h2>
      {summary && summary.totalReviews > 0 ? (
        <RatingSummary summary={summary} />
      ) : (
        <p style={{ color: 'var(--color-text-muted)' }}>No reviews yet.</p>
      )}

      {summary && summary.totalReviews > 0 && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <select
              value={ratingFilter}
              onChange={(e) => { setRatingFilter(e.target.value); setPage(1); }}
              style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6 }}
            >
              <option value="">All ratings</option>
              {[5, 4, 3, 2, 1].map((r) => (
                <option key={r} value={r}>
                  {r} star{r > 1 ? 's' : ''}
                </option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value as 'createdAt' | 'rating'); setPage(1); }}
              style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6 }}
            >
              <option value="createdAt">Most recent</option>
              <option value="rating">Highest rated</option>
            </select>
          </div>

          {isLoading && <div className="empty-state">Loading reviews…</div>}
          {!isLoading && items.length === 0 && <div className="empty-state">No reviews match this filter.</div>}
          {!isLoading &&
            items.map((review) => <ReviewCard key={review.id} review={review} />)}

          {pagination && pagination.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--outline"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn--outline"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <WriteReview productId={productId} />
    </section>
  );
}
