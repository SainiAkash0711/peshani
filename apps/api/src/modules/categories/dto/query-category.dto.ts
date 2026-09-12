import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const SORT_FIELDS = ['name', 'sortOrder', 'createdAt', 'updatedAt'] as const;

export class QueryCategoryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsUUID()
  parentId?: string;

  // When true, return only top-level (parentId = null) categories.
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  rootOnly?: boolean;

  // When true, return only subcategories (parentId is not null) - the
  // admin's dedicated Subcategories page uses this so it never shows a
  // top-level category alongside real subcategories.
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  subcategoriesOnly?: boolean;

  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: (typeof SORT_FIELDS)[number] = 'sortOrder';
}
