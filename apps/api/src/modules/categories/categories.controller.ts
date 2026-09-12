import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { QueryCategoryDto } from './dto/query-category.dto';
import { UpdateCategoryStatusDto } from './dto/update-category-status.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';

@ApiTags('categories')
@UseGuards(PermissionsGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Permissions('category.create')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(user.storeId, dto, user);
  }

  @Permissions('category.read')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryCategoryDto) {
    return this.categoriesService.findAll(user.storeId, query);
  }

  @Permissions('category.read')
  @Get('tree')
  findTree(@CurrentUser() user: AuthenticatedUser) {
    return this.categoriesService.findTree(user.storeId);
  }

  @Permissions('category.update')
  @Patch('reorder')
  reorder(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReorderCategoriesDto) {
    return this.categoriesService.reorder(user.storeId, dto, user);
  }

  @Permissions('category.read')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.findOne(user.storeId, id);
  }

  @Permissions('category.update')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(user.storeId, id, dto, user);
  }

  @Permissions('category.status')
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryStatusDto,
  ) {
    return this.categoriesService.updateStatus(user.storeId, id, dto, user);
  }

  @Permissions('category.delete')
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.remove(user.storeId, id, user);
  }
}
