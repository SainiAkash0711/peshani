import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ReturnReason, ReturnStatus } from '@prisma/client';

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
const RETURN_REASONS: ReturnReason[] = ['DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'WRONG_SIZE', 'NOT_AS_DESCRIBED', 'CHANGED_MIND', 'OTHER'];

export class QueryAdminReturnsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  @IsOptional()
  @IsIn(RETURN_STATUSES)
  status?: ReturnStatus;

  @IsOptional()
  @IsIn(RETURN_REASONS)
  reason?: ReturnReason;

  @IsOptional()
  @IsString()
  orderNumber?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;
}
