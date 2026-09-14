import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsSlug } from '../../../common/validators/slug.validator';

export const BLOG_POST_STATUSES = ['DRAFT', 'PUBLISHED'] as const;
export type BlogPostStatusInput = (typeof BLOG_POST_STATUSES)[number];

export class CreateBlogPostDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @IsSlug()
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  // HTML from the admin's rich text editor - much more verbose than the
  // equivalent plain text, hence the larger ceiling than a plain field would
  // need. Sanitized server-side (see BlogPostsService) before it's ever
  // persisted or rendered.
  @IsString()
  @MaxLength(200_000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  authorName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) =>
    Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : value,
  )
  tags?: string[];

  @IsOptional()
  @IsIn(BLOG_POST_STATUSES)
  status?: BlogPostStatusInput;
}
