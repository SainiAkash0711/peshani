import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ReviewStatus } from '@prisma/client';

const REVIEW_STATUSES: ReviewStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'HIDDEN'];
const SORT_FIELDS = ['createdAt', 'rating', 'status'] as const;

export class QueryAdminReviewsDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(REVIEW_STATUSES)
  status?: ReviewStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  verifiedPurchase?: boolean;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: (typeof SORT_FIELDS)[number] = 'createdAt';
}
