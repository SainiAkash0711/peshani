import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { ShippingMethodsService } from './shipping-methods.service';
import { CreateShippingMethodDto } from './dto/create-shipping-method.dto';
import { UpdateShippingMethodDto } from './dto/update-shipping-method.dto';
import { QueryShippingMethodDto } from './dto/query-shipping-method.dto';
import { UpdateShippingMethodStatusDto } from './dto/update-shipping-method-status.dto';

@ApiTags('shipping-methods')
@UseGuards(PermissionsGuard)
@Controller('shipping-methods')
export class ShippingMethodsController {
  constructor(
    private readonly shippingMethodsService: ShippingMethodsService,
    private readonly storeSettingsService: StoreSettingsService,
  ) {}

  /**
   * Public, unauthenticated - the customer-facing checkout flow needs to
   * list available shipping methods before the customer has necessarily
   * authenticated for anything shipping-specific. Declared BEFORE :id below
   * so Nest's route matching never treats "available" as an :id param.
   */
  @Public()
  @Get('available')
  async findAvailable() {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.shippingMethodsService.findActiveForStorefront(store.id);
  }

  @Permissions('shipping_method.create')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateShippingMethodDto) {
    return this.shippingMethodsService.create(user.storeId, dto, user);
  }

  @Permissions('shipping_method.read')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryShippingMethodDto) {
    return this.shippingMethodsService.findAll(user.storeId, query);
  }

  @Permissions('shipping_method.read')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.shippingMethodsService.findOne(user.storeId, id);
  }

  @Permissions('shipping_method.update')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShippingMethodDto,
  ) {
    return this.shippingMethodsService.update(user.storeId, id, dto, user);
  }

  @Permissions('shipping_method.status')
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShippingMethodStatusDto,
  ) {
    return this.shippingMethodsService.updateStatus(user.storeId, id, dto, user);
  }

  @Permissions('shipping_method.delete')
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.shippingMethodsService.remove(user.storeId, id, user);
  }
}
