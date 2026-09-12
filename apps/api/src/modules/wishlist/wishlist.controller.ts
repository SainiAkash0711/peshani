import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { WishlistService } from './wishlist.service';
import { AddWishlistItemDto } from './dto/add-wishlist-item.dto';
import { MoveToCartDto } from './dto/move-to-cart.dto';

/**
 * No @Public() anywhere - authenticated customer only (see WishlistService's
 * own doc comment on why guest wishlist was not implemented). storeId/userId
 * always come from the JWT, never the client.
 */
@ApiTags('wishlist')
@Controller('wishlist')
export class WishlistController {
  constructor(private readonly wishlistService: WishlistService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.wishlistService.getWishlist(user.storeId, user.userId);
  }

  @Post('items')
  addItem(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddWishlistItemDto) {
    return this.wishlistService.addItem(user.storeId, user.userId, dto);
  }

  @Delete('items/:id')
  removeItem(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.wishlistService.removeItem(user.storeId, user.userId, id);
  }

  @Post('items/:id/move-to-cart')
  moveToCart(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveToCartDto) {
    return this.wishlistService.moveToCart(user.storeId, user, id, dto);
  }
}
