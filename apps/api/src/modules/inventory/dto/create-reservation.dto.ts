import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateReservationDto {
  @IsUUID()
  inventoryItemId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  // How long the reservation holds stock before it's considered expired.
  // The model is expiration-ready (StockReservation.expiresAt); no background
  // worker actually sweeps expired reservations yet (see Phase 2F report).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_080)
  expiresInMinutes?: number;
}
