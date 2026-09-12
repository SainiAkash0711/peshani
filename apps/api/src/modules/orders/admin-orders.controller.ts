import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { OrderService } from './order.service';
import { OrderStatusService } from './order-status.service';
import { QueryAdminOrdersDto } from './dto/query-admin-orders.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { FulfillOrderDto } from './dto/fulfill-order.dto';

/**
 * Admin order management (Phase 6 §19-§21). Every route is storeId-scoped
 * from the JWT via @CurrentUser() - never a client-supplied storeId - and
 * gated by its own permission, following the exact convention every other
 * admin controller in this codebase already uses (see WarehousesController).
 */
@ApiTags('admin-orders')
@UseGuards(PermissionsGuard)
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(
    private readonly orderService: OrderService,
    private readonly orderStatusService: OrderStatusService,
  ) {}

  @Permissions('order.read')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryAdminOrdersDto) {
    return this.orderService.findAllForAdmin(user.storeId, query);
  }

  @Permissions('order.read')
  @Get(':orderNumber')
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('orderNumber') orderNumber: string) {
    const order = await this.orderService.getScopedOrderForAdminOrThrow(user.storeId, orderNumber);
    return this.orderService.toAdminDetail(order);
  }

  @Permissions('order.status')
  @Patch(':orderNumber/status')
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderNumber') orderNumber: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    await this.orderStatusService.transition(user.storeId, orderNumber, dto.status, user, { source: 'ADMIN', reason: dto.reason });
    const order = await this.orderService.getScopedOrderForAdminOrThrow(user.storeId, orderNumber);
    return this.orderService.toAdminDetail(order);
  }

  @Permissions('order.fulfill')
  @Post(':orderNumber/fulfill')
  async fulfill(@CurrentUser() user: AuthenticatedUser, @Param('orderNumber') orderNumber: string, @Body() dto: FulfillOrderDto) {
    await this.orderStatusService.fulfill(user.storeId, orderNumber, user, { reason: dto.reason });
    const order = await this.orderService.getScopedOrderForAdminOrThrow(user.storeId, orderNumber);
    return this.orderService.toAdminDetail(order);
  }
}
