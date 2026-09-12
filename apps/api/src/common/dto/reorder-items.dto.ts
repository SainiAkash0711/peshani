import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';

export class OrderItemDto {
  @IsUUID()
  id!: string;

  @IsInt()
  @Min(0)
  sortOrder!: number;
}

// New for Phase 2E media reorder endpoints. Categories/AttributeValues already
// have their own near-identical DTOs predating this one - left as-is rather
// than refactored, since neither is broken and touching tested code without
// a real bug isn't worth the risk.
export class ReorderItemsDto {
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique((item: OrderItemDto) => item.id)
  items!: OrderItemDto[];
}
