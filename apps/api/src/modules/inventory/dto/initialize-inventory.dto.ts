import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class InitializeInventoryDto {
  @IsUUID()
  warehouseId!: string;

  @IsUUID()
  productId!: string;

  // Omit for a SIMPLE product; required for a VARIABLE product's variant.
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsInt()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;
}
