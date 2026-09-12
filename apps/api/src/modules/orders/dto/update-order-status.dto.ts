import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// Deliberately excludes CONFIRMED (PaymentService's alone to set) and PACKED
// (only reachable via the dedicated /fulfill endpoint - see OrderStatusService).
const ADMIN_SETTABLE_STATUSES = ['PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;

export class UpdateOrderStatusDto {
  @IsIn(ADMIN_SETTABLE_STATUSES)
  status!: (typeof ADMIN_SETTABLE_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
