import { IsOptional, IsUUID } from 'class-validator';

export class AddWishlistItemDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;
}
