import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { BrandsService } from './brands.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { QueryBrandDto } from './dto/query-brand.dto';
import { UpdateBrandStatusDto } from './dto/update-brand-status.dto';

@ApiTags('brands')
@UseGuards(PermissionsGuard)
@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Permissions('brand.create')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBrandDto) {
    return this.brandsService.create(user.storeId, dto, user);
  }

  @Permissions('brand.read')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryBrandDto) {
    return this.brandsService.findAll(user.storeId, query);
  }

  @Permissions('brand.read')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.brandsService.findOne(user.storeId, id);
  }

  @Permissions('brand.update')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrandDto,
  ) {
    return this.brandsService.update(user.storeId, id, dto, user);
  }

  @Permissions('brand.status')
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrandStatusDto,
  ) {
    return this.brandsService.updateStatus(user.storeId, id, dto, user);
  }

  @Permissions('brand.delete')
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.brandsService.remove(user.storeId, id, user);
  }
}
