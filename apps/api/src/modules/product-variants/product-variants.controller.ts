import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ProductVariantsService } from './product-variants.service';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { UpdateVariantStatusDto } from './dto/update-variant-status.dto';
import { GenerateVariantsDto } from './dto/generate-variants.dto';
import { AxesInputDto } from './dto/variant-axis.dto';

@ApiTags('product-variants')
@UseGuards(PermissionsGuard)
@Controller('products/:productId/variants')
export class ProductVariantsController {
  constructor(private readonly productVariantsService: ProductVariantsService) {}

  @Permissions('product_variant.create')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.productVariantsService.create(user.storeId, productId, dto, user);
  }

  @Permissions('product_variant.read')
  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.productVariantsService.findAll(user.storeId, productId, query);
  }

  @Permissions('product_variant.read')
  @HttpCode(HttpStatus.OK)
  @Post('preview-combinations')
  previewCombinations(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: AxesInputDto,
  ) {
    return this.productVariantsService.previewCombinations(user.storeId, productId, dto);
  }

  @Permissions('product_variant.create')
  @Post('generate')
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: GenerateVariantsDto,
  ) {
    return this.productVariantsService.generate(user.storeId, productId, dto, user);
  }

  @Permissions('product_variant.read')
  @Get(':variantId')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.productVariantsService.findOne(user.storeId, productId, variantId);
  }

  @Permissions('product_variant.update')
  @Patch(':variantId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.productVariantsService.update(user.storeId, productId, variantId, dto, user);
  }

  @Permissions('product_variant.status')
  @Patch(':variantId/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateVariantStatusDto,
  ) {
    return this.productVariantsService.updateStatus(user.storeId, productId, variantId, dto, user);
  }

  @Permissions('product_variant.delete')
  @Delete(':variantId')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.productVariantsService.remove(user.storeId, productId, variantId, user);
  }
}
