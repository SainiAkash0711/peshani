import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const SORT_FIELDS = ['name', 'sortOrder', 'createdAt', 'updatedAt'] as const;

export class QueryPromotionDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: (typeof SORT_FIELDS)[number] = 'sortOrder';
}
