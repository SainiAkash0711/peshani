import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { WarehousesService } from './warehouses.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { QueryWarehouseDto } from './dto/query-warehouse.dto';
import { UpdateWarehouseStatusDto } from './dto/update-warehouse-status.dto';

@ApiTags('warehouses')
@UseGuards(PermissionsGuard)
@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Permissions('warehouse.create')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWarehouseDto) {
    return this.warehousesService.create(user.storeId, dto, user);
  }

  @Permissions('warehouse.read')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryWarehouseDto) {
    return this.warehousesService.findAll(user.storeId, query);
  }

  @Permissions('warehouse.read')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.warehousesService.findOne(user.storeId, id);
  }

  @Permissions('warehouse.update')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
  ) {
    return this.warehousesService.update(user.storeId, id, dto, user);
  }

  @Permissions('warehouse.status')
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseStatusDto,
  ) {
    return this.warehousesService.updateStatus(user.storeId, id, dto, user);
  }

  @Permissions('warehouse.delete')
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.warehousesService.remove(user.storeId, id, user);
  }
}
