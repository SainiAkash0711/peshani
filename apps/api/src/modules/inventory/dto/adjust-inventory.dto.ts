import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, NotEquals } from 'class-validator';

export class AdjustInventoryDto {
  @IsUUID()
  inventoryItemId!: string;

  // Signed delta: positive adds stock, negative removes it. Zero is rejected -
  // it's not a meaningful adjustment and is almost certainly a client bug.
  @IsInt()
  @NotEquals(0)
  quantity!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;
}
