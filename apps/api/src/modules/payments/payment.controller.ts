import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PaymentService } from './payment.service';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { throttleLimit } from '../../common/utils/throttle.util';

@ApiTags('payments')
@Controller('payments/razorpay')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  // No @Public() - requires the authenticated customer who owns the order
  // (see PaymentService.verifyPayment's ownership check via OrderService).
  @Post('verify')
  async verify(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyPaymentDto) {
    return this.paymentService.verifyPayment(user.storeId, user.userId, dto, user);
  }

  /**
   * The one route in this whole API that is BOTH @Public() (Razorpay's
   * servers carry no Peshani JWT) AND reads the raw request body directly
   * (req.rawBody, populated because main.ts enables `rawBody: true`) rather
   * than the framework-parsed @Body() - webhook signature verification is
   * only meaningful against the exact bytes Razorpay signed (§25).
   *
   * Deliberately NOT rate-limited as tightly as customer-facing endpoints -
   * Razorpay's own servers are the only realistic caller, and throttling
   * legitimate webhook delivery would just make Razorpay retry harder later.
   */
  @Public()
  @Throttle({ default: { limit: throttleLimit(120), ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('webhook')
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') signature?: string) {
    if (!req.rawBody) {
      throw new BadRequestException('Missing request body');
    }
    return this.paymentService.processWebhook(req.rawBody.toString('utf8'), signature);
  }
}
