import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { MAX_CART_ITEM_QUANTITY } from './add-cart-item.dto';

export class UpdateCartItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CART_ITEM_QUANTITY)
  quantity!: number;
}
