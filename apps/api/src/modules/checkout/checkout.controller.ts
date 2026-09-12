import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CheckoutService } from './checkout.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { ValidateCouponDto } from '../promotions/dto/validate-coupon.dto';
import { throttleLimit } from '../../common/utils/throttle.util';

/**
 * No @Public() anywhere - checkout requires an authenticated customer
 * (§53/§54). A guest cart cannot reach any of these routes at all; the
 * storefront's own UX is expected to send an unauthenticated visitor to
 * login/register first, preserving their cart (see the Phase 4 guest->
 * customer merge - login already carries the cart forward automatically).
 */
@ApiTags('checkout')
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post('validate')
  validate(@CurrentUser() user: AuthenticatedUser) {
    return this.checkoutService.validate(user.storeId, user.userId);
  }

  @Throttle({ default: { limit: throttleLimit(20), ttl: 60_000 } })
  @Post('coupon/validate')
  validateCoupon(@CurrentUser() user: AuthenticatedUser, @Body() dto: ValidateCouponDto) {
    return this.checkoutService.validateCoupon(user.storeId, user.userId, dto);
  }

  @Throttle({ default: { limit: throttleLimit(10), ttl: 60_000 } })
  @Post('create')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCheckoutDto, @Headers('idempotency-key') idempotencyKey?: string) {
    return this.checkoutService.createCheckout(user.storeId, user.userId, dto, user, idempotencyKey);
  }

  @Throttle({ default: { limit: throttleLimit(10), ttl: 60_000 } })
  @Post('orders/:orderNumber/retry-payment')
  retryPayment(@CurrentUser() user: AuthenticatedUser, @Param('orderNumber') orderNumber: string) {
    return this.checkoutService.retryPayment(user.storeId, user.userId, orderNumber, user);
  }
}
