import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { OrderService } from './order.service';
import { OrderStatusService } from './order-status.service';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { ReturnEligibilityService } from '../returns/return-eligibility.service';

/**
 * No @Public() anywhere here - every route requires the global JwtAuthGuard
 * to have already populated `request.user`, and every query is scoped to
 * `user.storeId`/`user.userId` from the JWT, never a client-supplied id
 * (see §42/§43). Requesting another customer's orderNumber returns a plain
 * 404, identical to an unknown one - it never reveals whether that order
 * exists at all.
 */
@ApiTags('orders')
@Controller('orders')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly orderStatusService: OrderStatusService,
    private readonly returnEligibilityService: ReturnEligibilityService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.orderService.findForCustomer(user.storeId, user.userId, query);
  }

  @Get(':orderNumber')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('orderNumber') orderNumber: string) {
    return this.orderService.findOneForCustomer(user.storeId, user.userId, orderNumber);
  }

  /** Phase 10 §11/§28 - fully server-computed; the frontend's "Request Return" button visibility is UX only, never authoritative (§35). */
  @Get(':orderNumber/return-eligibility')
  checkReturnEligibility(@CurrentUser() user: AuthenticatedUser, @Param('orderNumber') orderNumber: string) {
    return this.returnEligibilityService.checkOrderEligibility(user.storeId, orderNumber, user.userId);
  }

  /**
   * Phase 6 §26 - customer-initiated cancellation, restricted to states
   * where it is safe (PENDING_PAYMENT/CONFIRMED - see
   * OrderStatusService.CUSTOMER_CANCELLABLE_FROM). Never triggers a refund -
   * a captured payment's own state is untouched; cancellation is recorded,
   * nothing more, exactly as the Phase 6 prompt requires.
   */
  @Post(':orderNumber/cancel')
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderNumber') orderNumber: string,
    @Body() dto: CancelOrderDto,
  ) {
    await this.orderStatusService.transition(user.storeId, orderNumber, 'CANCELLED', user, { source: 'CUSTOMER', reason: dto.reason });
    return this.orderService.findOneForCustomer(user.storeId, user.userId, orderNumber);
  }
}
