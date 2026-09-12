import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

const GUEST_TOKEN_REQUEST_HEADER = 'x-guest-cart-token';
const GUEST_TOKEN_RESPONSE_HEADER = 'x-guest-cart-token';

/**
 * Every route works for BOTH a guest (no Bearer token) and an authenticated
 * customer (valid Bearer token) - @Public() bypasses the global JwtAuthGuard,
 * and OptionalJwtAuthGuard (unlike the global guard) actually attempts to
 * populate `request.user` when a token IS present, without ever rejecting
 * the request when it's absent or invalid. See that guard's doc comment.
 *
 * storeId resolution follows the same split used everywhere else in this
 * codebase: an AUTHENTICATED request trusts `user.storeId` from the JWT
 * (never a client-supplied value) exactly like every admin route does via
 * CurrentUser; a GUEST request has no JWT to trust, so it falls back to
 * StoreSettingsService.getDefaultStore() exactly like Phase 3's public
 * storefront routes do. Blindly using getDefaultStore() for BOTH cases would
 * mis-attribute an authenticated Store B customer's cart to Store A's
 * storeId - a real tenant-isolation bug caught during this phase's live
 * smoke test (see the Phase 4 final report).
 *
 * The guest cart identity travels as a plain request/response header, never
 * a cookie set by this API directly - the customer storefront (a different
 * origin) is responsible for persisting it as an HttpOnly cookie of its own
 * and forwarding it back on every request. This keeps the API exactly as
 * cookie-agnostic as every other module (pure Bearer/header auth), and
 * avoids all cross-origin-cookie complications entirely.
 */
@ApiTags('cart')
@Public()
@UseGuards(OptionalJwtAuthGuard)
@Controller('cart')
export class CartController {
  constructor(
    private readonly cartService: CartService,
    private readonly storeSettingsService: StoreSettingsService,
  ) {}

  @Get()
  async getCart(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Headers(GUEST_TOKEN_REQUEST_HEADER) guestToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { cartId } = await this.resolveCartForRequest(user, guestToken, res);
    return this.cartService.getCart(cartId);
  }

  @Post('items')
  async addItem(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Headers(GUEST_TOKEN_REQUEST_HEADER) guestToken: string | undefined,
    @Body() dto: AddCartItemDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { cartId, storeId } = await this.resolveCartForRequest(user, guestToken, res);
    return this.cartService.addItem(cartId, storeId, dto, user?.userId);
  }

  @Patch('items/:itemId')
  async updateItem(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Headers(GUEST_TOKEN_REQUEST_HEADER) guestToken: string | undefined,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateCartItemDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { cartId, storeId } = await this.resolveCartForRequest(user, guestToken, res);
    return this.cartService.updateItemQuantity(cartId, storeId, itemId, dto, user?.userId);
  }

  @Delete('items/:itemId')
  async removeItem(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Headers(GUEST_TOKEN_REQUEST_HEADER) guestToken: string | undefined,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { cartId, storeId } = await this.resolveCartForRequest(user, guestToken, res);
    return this.cartService.removeItem(cartId, storeId, itemId, user?.userId);
  }

  @Delete()
  async clearCart(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Headers(GUEST_TOKEN_REQUEST_HEADER) guestToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { cartId, storeId } = await this.resolveCartForRequest(user, guestToken, res);
    return this.cartService.clearCart(cartId, storeId, user?.userId);
  }

  @Post('validate')
  async validate(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Headers(GUEST_TOKEN_REQUEST_HEADER) guestToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { cartId } = await this.resolveCartForRequest(user, guestToken, res);
    return this.cartService.validateCart(cartId);
  }

  private async resolveCartForRequest(
    user: AuthenticatedUser | undefined,
    guestToken: string | undefined,
    res: Response,
  ): Promise<{ cartId: string; storeId: string; newGuestToken?: string }> {
    const storeId = user ? user.storeId : (await this.storeSettingsService.getDefaultStore()).id;
    const result = await this.cartService.resolveCart({ storeId, userId: user?.userId, guestToken });
    if (result.newGuestToken) {
      res.setHeader(GUEST_TOKEN_RESPONSE_HEADER, result.newGuestToken);
    }
    return { ...result, storeId };
  }
}
