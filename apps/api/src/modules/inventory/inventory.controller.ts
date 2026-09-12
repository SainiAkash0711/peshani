import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { InventoryService } from './inventory.service';
import { InitializeInventoryDto } from './dto/initialize-inventory.dto';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { TransferInventoryDto } from './dto/transfer-inventory.dto';
import { QueryInventoryDto } from './dto/query-inventory.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

@ApiTags('inventory')
@UseGuards(PermissionsGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Permissions('inventory.adjust')
  @Post()
  initialize(@CurrentUser() user: AuthenticatedUser, @Body() dto: InitializeInventoryDto) {
    return this.inventoryService.initialize(user.storeId, dto, user);
  }

  @Permissions('inventory.read')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryInventoryDto) {
    return this.inventoryService.findAll(user.storeId, query);
  }

  @Permissions('inventory.adjust')
  @Post('adjust')
  adjust(@CurrentUser() user: AuthenticatedUser, @Body() dto: AdjustInventoryDto) {
    return this.inventoryService.adjust(user.storeId, dto, user);
  }

  @Permissions('inventory.transfer')
  @Post('transfer')
  transfer(@CurrentUser() user: AuthenticatedUser, @Body() dto: TransferInventoryDto) {
    return this.inventoryService.transfer(user.storeId, dto, user);
  }

  @Permissions('inventory.reserve')
  @Post('reservations')
  reserve(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReservationDto) {
    return this.inventoryService.reserve(user.storeId, dto, user);
  }

  @Permissions('inventory.read')
  @Get('reservations/:id')
  findReservation(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventoryService.findReservation(user.storeId, id);
  }

  @Permissions('inventory.release')
  @Post('reservations/:id/release')
  release(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventoryService.release(user.storeId, id, user);
  }

  @Permissions('inventory.reserve')
  @Post('reservations/:id/consume')
  consume(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventoryService.consume(user.storeId, id, user);
  }

  @Permissions('inventory.read')
  @Get(':id/transactions')
  findTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.inventoryService.findTransactions(user.storeId, id, query);
  }

  @Permissions('inventory.read')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventoryService.findOne(user.storeId, id);
  }
}
