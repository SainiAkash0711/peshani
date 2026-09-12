import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID, ValidateNested } from 'class-validator';

export class VariantAxisDto {
  @IsUUID()
  attributeId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  valueIds!: string[];
}

export class AxesInputDto {
  @ValidateNested({ each: true })
  @Type(() => VariantAxisDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  axes!: VariantAxisDto[];
}
