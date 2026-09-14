import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { BLOG_POST_STATUSES, BlogPostStatusInput } from './create-blog-post.dto';

const SORT_FIELDS = ['createdAt', 'publishedAt', 'title'] as const;

export class QueryBlogPostDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(BLOG_POST_STATUSES)
  status?: BlogPostStatusInput;

  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: (typeof SORT_FIELDS)[number] = 'createdAt';
}
