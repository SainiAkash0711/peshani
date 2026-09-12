import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

const PRESETS = ['today', 'yesterday', 'last7days', 'last30days', 'last90days', 'thisMonth', 'lastMonth', 'thisYear', 'custom'];

export class AnalyticsQueryDto {
  @IsOptional()
  @IsIn(PRESETS)
  preset?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}
