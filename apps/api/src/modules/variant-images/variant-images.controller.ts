import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { ReorderItemsDto } from '../../common/dto/reorder-items.dto';
import { VariantImagesService } from './variant-images.service';
import { UpdateVariantImageDto } from './dto/update-variant-image.dto';

const MULTER_HARD_CEILING_BYTES = 20 * 1024 * 1024;

@ApiTags('variant-images')
@UseGuards(PermissionsGuard)
@Controller('products/:productId/variants/:variantId/images')
export class VariantImagesController {
  constructor(private readonly variantImagesService: VariantImagesService) {}

  @Permissions('product_media.create')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MULTER_HARD_CEILING_BYTES, files: 1 } }))
  @Post()
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UpdateVariantImageDto,
  ) {
    return this.variantImagesService.upload(user.storeId, productId, variantId, file, dto, user);
  }

  @Permissions('product_media.read')
  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.variantImagesService.findAll(user.storeId, productId, variantId);
  }

  @Permissions('product_media.reorder')
  @Patch('reorder')
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: ReorderItemsDto,
  ) {
    return this.variantImagesService.reorder(user.storeId, productId, variantId, dto, user);
  }

  @Permissions('product_media.update')
  @Patch(':imageId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: UpdateVariantImageDto,
  ) {
    return this.variantImagesService.update(user.storeId, productId, variantId, imageId, dto, user);
  }

  @Permissions('product_media.primary')
  @Patch(':imageId/primary')
  setPrimary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.variantImagesService.setPrimary(user.storeId, productId, variantId, imageId, user);
  }

  @Permissions('product_media.delete')
  @Delete(':imageId')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.variantImagesService.remove(user.storeId, productId, variantId, imageId, user);
  }
}
