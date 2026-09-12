import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';

export class CategoryOrderItemDto {
  @IsUUID()
  id!: string;

  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class ReorderCategoriesDto {
  @ValidateNested({ each: true })
  @Type(() => CategoryOrderItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  items!: CategoryOrderItemDto[];
}
