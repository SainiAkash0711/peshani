import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { AttributeType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const SORT_FIELDS = ['name', 'sortOrder', 'createdAt', 'updatedAt'] as const;

export class QueryAttributeDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsEnum(AttributeType)
  type?: AttributeType;

  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: (typeof SORT_FIELDS)[number] = 'sortOrder';
}
