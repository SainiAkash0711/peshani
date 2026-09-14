import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsSlug } from '../../../common/validators/slug.validator';
import { BLOG_POST_STATUSES, BlogPostStatusInput } from './create-blog-post.dto';

export class UpdateBlogPostDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @IsSlug()
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  content?: string;

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
