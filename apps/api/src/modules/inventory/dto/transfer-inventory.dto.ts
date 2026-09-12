import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class TransferInventoryDto {
  @IsUUID()
  sourceWarehouseId!: string;

  @IsUUID()
  destinationWarehouseId!: string;

  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
