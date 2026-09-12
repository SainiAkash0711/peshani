import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AttributeValuesService } from './attribute-values.service';
import { CreateAttributeValueDto } from './dto/create-attribute-value.dto';
import { UpdateAttributeValueDto } from './dto/update-attribute-value.dto';
import { UpdateAttributeValueStatusDto } from './dto/update-attribute-value-status.dto';
import { ReorderAttributeValuesDto } from './dto/reorder-attribute-values.dto';

@ApiTags('attribute-values')
@UseGuards(PermissionsGuard)
@Controller('attributes/:attributeId/values')
export class AttributeValuesController {
  constructor(private readonly attributeValuesService: AttributeValuesService) {}

  @Permissions('attribute_value.create')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attributeId', ParseUUIDPipe) attributeId: string,
    @Body() dto: CreateAttributeValueDto,
  ) {
    return this.attributeValuesService.create(user.storeId, attributeId, dto, user);
  }

  @Permissions('attribute_value.read')
  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attributeId', ParseUUIDPipe) attributeId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.attributeValuesService.findAll(user.storeId, attributeId, query);
  }

  @Permissions('attribute_value.update')
  @Patch('reorder')
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attributeId', ParseUUIDPipe) attributeId: string,
    @Body() dto: ReorderAttributeValuesDto,
  ) {
    return this.attributeValuesService.reorder(user.storeId, attributeId, dto, user);
  }

  @Permissions('attribute_value.read')
  @Get(':valueId')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attributeId', ParseUUIDPipe) attributeId: string,
    @Param('valueId', ParseUUIDPipe) valueId: string,
  ) {
    return this.attributeValuesService.findOne(user.storeId, attributeId, valueId);
  }

  @Permissions('attribute_value.update')
  @Patch(':valueId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attributeId', ParseUUIDPipe) attributeId: string,
    @Param('valueId', ParseUUIDPipe) valueId: string,
    @Body() dto: UpdateAttributeValueDto,
  ) {
    return this.attributeValuesService.update(user.storeId, attributeId, valueId, dto, user);
  }

  @Permissions('attribute_value.status')
  @Patch(':valueId/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attributeId', ParseUUIDPipe) attributeId: string,
    @Param('valueId', ParseUUIDPipe) valueId: string,
    @Body() dto: UpdateAttributeValueStatusDto,
  ) {
    return this.attributeValuesService.updateStatus(user.storeId, attributeId, valueId, dto, user);
  }

  @Permissions('attribute_value.delete')
  @Delete(':valueId')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attributeId', ParseUUIDPipe) attributeId: string,
    @Param('valueId', ParseUUIDPipe) valueId: string,
  ) {
    return this.attributeValuesService.remove(user.storeId, attributeId, valueId, user);
  }
}
