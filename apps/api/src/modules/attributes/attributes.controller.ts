import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { AttributesService } from './attributes.service';
import { CreateAttributeDto } from './dto/create-attribute.dto';
import { UpdateAttributeDto } from './dto/update-attribute.dto';
import { QueryAttributeDto } from './dto/query-attribute.dto';
import { UpdateAttributeStatusDto } from './dto/update-attribute-status.dto';

@ApiTags('attributes')
@UseGuards(PermissionsGuard)
@Controller('attributes')
export class AttributesController {
  constructor(private readonly attributesService: AttributesService) {}

  @Permissions('attribute.create')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAttributeDto) {
    return this.attributesService.create(user.storeId, dto, user);
  }

  @Permissions('attribute.read')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryAttributeDto) {
    return this.attributesService.findAll(user.storeId, query);
  }

  @Permissions('attribute.read')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.attributesService.findOne(user.storeId, id);
  }

  @Permissions('attribute.update')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAttributeDto,
  ) {
    return this.attributesService.update(user.storeId, id, dto, user);
  }

  @Permissions('attribute.status')
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAttributeStatusDto,
  ) {
    return this.attributesService.updateStatus(user.storeId, id, dto, user);
  }

  @Permissions('attribute.delete')
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.attributesService.remove(user.storeId, id, user);
  }
}
