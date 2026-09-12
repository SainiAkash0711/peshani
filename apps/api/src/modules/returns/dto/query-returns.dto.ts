import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { ReturnStatus } from '@prisma/client';

const RETURN_STATUSES: ReturnStatus[] = [
  'REQUESTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'IN_TRANSIT',
  'RECEIVED',
  'REFUND_PENDING',
  'REFUND_INITIATED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'COMPLETED',
];

export class QueryReturnsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize: number = 20;

  @IsOptional()
  @IsIn(RETURN_STATUSES)
  status?: ReturnStatus;
}
