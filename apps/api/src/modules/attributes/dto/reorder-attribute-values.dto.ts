import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';

export class AttributeValueOrderItemDto {
  @IsUUID()
  id!: string;

  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class ReorderAttributeValuesDto {
  @ValidateNested({ each: true })
  @Type(() => AttributeValueOrderItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  items!: AttributeValueOrderItemDto[];
}
