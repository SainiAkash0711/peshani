export interface PublicReview {
  id: string;
  reviewerDisplayName: string;
  rating: number;
  title: string | null;
  body: string;
  verifiedPurchase: boolean;
  createdAt: string;
  helpfulCount: number;
}

export interface ReviewSummary {
  productId: string;
  totalReviews: number;
  averageRating: number;
  distribution: Record<'5' | '4' | '3' | '2' | '1', number>;
}

export interface HelpfulVoteResult {
  reviewId: string;
  helpfulCount: number;
  votedByCurrentUser: boolean;
}

export interface ReportReviewResult {
  reviewId: string;
  reported: boolean;
}
