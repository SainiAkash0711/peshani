import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsUUID, ValidateNested } from 'class-validator';
import { InventoryDisposition, ReturnItemCondition } from '@prisma/client';

const ITEM_CONDITIONS: ReturnItemCondition[] = ['NEW', 'OPENED', 'USED', 'DAMAGED', 'DEFECTIVE'];
const DISPOSITIONS: InventoryDisposition[] = ['RESTOCK', 'DAMAGED', 'UNSELLABLE'];

export class InspectReturnItemDto {
  @IsUUID()
  returnItemId!: string;

  @IsIn(ITEM_CONDITIONS)
  itemCondition!: ReturnItemCondition;

  @IsIn(DISPOSITIONS)
  disposition!: InventoryDisposition;
}

export class InspectReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InspectReturnItemDto)
  items!: InspectReturnItemDto[];
}
