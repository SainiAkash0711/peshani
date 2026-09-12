import { IsIn, IsOptional } from 'class-validator';
import { AnalyticsQueryDto } from './analytics-query.dto';

const GRANULARITIES = ['daily', 'weekly', 'monthly'];

/**
 * A real class (not a `AnalyticsQueryDto & { ... }` intersection type, which
 * erases to `Object` at runtime and would make Nest's ValidationPipe skip
 * whitelisting/validation for this endpoint entirely - see the Phase 11
 * report for the defect this caused).
 */
export class SalesQueryDto extends AnalyticsQueryDto {
  @IsOptional()
  @IsIn(GRANULARITIES)
  granularity?: string;
}
