import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PromotionsService } from './promotions.service';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';
import { QueryPromotionDto } from './dto/query-promotion.dto';
import { UpdatePromotionStatusDto } from './dto/update-promotion-status.dto';

@ApiTags('promotions')
@UseGuards(PermissionsGuard)
@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Permissions('promotion.create')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePromotionDto) {
    return this.promotionsService.create(user.storeId, dto, user);
  }

  @Permissions('promotion.read')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryPromotionDto) {
    return this.promotionsService.findAll(user.storeId, query);
  }

  @Permissions('promotion.read')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.promotionsService.findOne(user.storeId, id);
  }

  @Permissions('promotion.update')
  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePromotionDto) {
    return this.promotionsService.update(user.storeId, id, dto, user);
  }

  @Permissions('promotion.status')
  @Patch(':id/status')
  updateStatus(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePromotionStatusDto) {
    return this.promotionsService.updateStatus(user.storeId, id, dto, user);
  }

  @Permissions('promotion.delete')
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.promotionsService.remove(user.storeId, id, user);
  }
}
