import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { ReturnReason } from '@prisma/client';

const RETURN_REASONS: ReturnReason[] = ['DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'WRONG_SIZE', 'NOT_AS_DESCRIBED', 'CHANGED_MIND', 'OTHER'];

export class CreateReturnItemDto {
  @IsUUID()
  orderItemId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  quantity!: number;

  @IsOptional()
  @IsIn(RETURN_REASONS)
  reason?: ReturnReason;
}

/**
 * §29 - deliberately does NOT declare userId/storeId/refundAmount/
 * orderStatus/paymentStatus/returnStatus - a client value for any of these
 * could never be trusted even if a caller tried to send one, since
 * `forbidNonWhitelisted` (this codebase's global ValidationPipe config)
 * rejects the request outright rather than silently ignoring the extra field.
 */
export class CreateReturnRequestDto {
  @IsString()
  @MaxLength(64)
  orderNumber!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateReturnItemDto)
  items!: CreateReturnItemDto[];

  @IsIn(RETURN_REASONS)
  reason!: ReturnReason;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customerComment?: string;
}
