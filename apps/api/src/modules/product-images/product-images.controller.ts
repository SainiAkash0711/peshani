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
import { ProductImagesService } from './product-images.service';
import { UpdateProductImageDto } from './dto/update-product-image.dto';

// Multer's own limit is a fixed backstop against a wildly oversized request
// body being held in memory at all (memoryStorage buffers the whole file);
// the actual configurable business limit (MEDIA_MAX_UPLOAD_BYTES) is enforced
// inside MediaUploadService, which can read live config - a decorator's
// options can't.
const MULTER_HARD_CEILING_BYTES = 20 * 1024 * 1024;

@ApiTags('product-images')
@UseGuards(PermissionsGuard)
@Controller('products/:productId/images')
export class ProductImagesController {
  constructor(private readonly productImagesService: ProductImagesService) {}

  @Permissions('product_media.create')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MULTER_HARD_CEILING_BYTES, files: 1 } }))
  @Post()
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UpdateProductImageDto,
  ) {
    return this.productImagesService.upload(user.storeId, productId, file, dto, user);
  }

  @Permissions('product_media.read')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.productImagesService.findAll(user.storeId, productId);
  }

  @Permissions('product_media.reorder')
  @Patch('reorder')
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: ReorderItemsDto,
  ) {
    return this.productImagesService.reorder(user.storeId, productId, dto, user);
  }

  @Permissions('product_media.update')
  @Patch(':imageId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: UpdateProductImageDto,
  ) {
    return this.productImagesService.update(user.storeId, productId, imageId, dto, user);
  }

  @Permissions('product_media.primary')
  @Patch(':imageId/primary')
  setPrimary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.productImagesService.setPrimary(user.storeId, productId, imageId, user);
  }

  @Permissions('product_media.delete')
  @Delete(':imageId')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.productImagesService.remove(user.storeId, productId, imageId, user);
  }
}
