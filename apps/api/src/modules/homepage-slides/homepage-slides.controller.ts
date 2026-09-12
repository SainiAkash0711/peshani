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
import { HomepageSlidesService } from './homepage-slides.service';
import { UpdateHomepageSlideDto } from './dto/update-homepage-slide.dto';

// Same fixed backstop as ProductImagesController - see that controller's
// own comment for why this differs from the configurable business limit.
const MULTER_HARD_CEILING_BYTES = 20 * 1024 * 1024;

@ApiTags('admin-homepage-slides')
@UseGuards(PermissionsGuard)
@Controller('admin/homepage-slides')
export class HomepageSlidesController {
  constructor(private readonly homepageSlidesService: HomepageSlidesService) {}

  @Permissions('homepage_slides.manage')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MULTER_HARD_CEILING_BYTES, files: 1 } }))
  @Post()
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UpdateHomepageSlideDto,
  ) {
    return this.homepageSlidesService.upload(user.storeId, file, dto, user);
  }

  @Permissions('homepage_slides.manage')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.homepageSlidesService.findAllForAdmin(user.storeId);
  }

  @Permissions('homepage_slides.manage')
  @Patch('reorder')
  reorder(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReorderItemsDto) {
    return this.homepageSlidesService.reorder(user.storeId, dto, user);
  }

  @Permissions('homepage_slides.manage')
  @Patch(':slideId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slideId', ParseUUIDPipe) slideId: string,
    @Body() dto: UpdateHomepageSlideDto,
  ) {
    return this.homepageSlidesService.update(user.storeId, slideId, dto, user);
  }

  @Permissions('homepage_slides.manage')
  @Delete(':slideId')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('slideId', ParseUUIDPipe) slideId: string) {
    return this.homepageSlidesService.remove(user.storeId, slideId, user);
  }
}
