import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { QueryCouponDto } from './dto/query-coupon.dto';
import { UpdateCouponStatusDto } from './dto/update-coupon-status.dto';

@ApiTags('coupons')
@UseGuards(PermissionsGuard)
@Controller('coupons')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Permissions('coupon.create')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCouponDto) {
    return this.couponsService.create(user.storeId, dto, user);
  }

  @Permissions('coupon.read')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryCouponDto) {
    return this.couponsService.findAll(user.storeId, query);
  }

  @Permissions('coupon.read')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.couponsService.findOne(user.storeId, id);
  }

  @Permissions('coupon.update')
  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCouponDto) {
    return this.couponsService.update(user.storeId, id, dto, user);
  }

  @Permissions('coupon.status')
  @Patch(':id/status')
  updateStatus(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCouponStatusDto) {
    return this.couponsService.updateStatus(user.storeId, id, dto, user);
  }

  @Permissions('coupon.delete')
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.couponsService.remove(user.storeId, id, user);
  }
}
