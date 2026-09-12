import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AnalyticsQueryDto } from './analytics-query.dto';

const SORT_BY = ['revenue', 'units'] as const;

/** §8/§27 - top products/customers/categories always take a bounded, configurable limit - never an unbounded table dump. */
export class TopListQueryDto extends AnalyticsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;

  @IsOptional()
  @IsIn(SORT_BY)
  sortBy?: (typeof SORT_BY)[number] = 'revenue';
}
