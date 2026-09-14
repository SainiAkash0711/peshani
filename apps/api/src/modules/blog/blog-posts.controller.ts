import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { BlogPostsService } from './blog-posts.service';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { QueryBlogPostDto } from './dto/query-blog-post.dto';

// Same fixed backstop as ProductImagesController/HomepageSlidesController -
// see those controllers' own comments for why this differs from the
// configurable business limit.
const MULTER_HARD_CEILING_BYTES = 20 * 1024 * 1024;

@ApiTags('admin-blog-posts')
@UseGuards(PermissionsGuard)
@Controller('admin/blog-posts')
export class BlogPostsController {
  constructor(private readonly blogPostsService: BlogPostsService) {}

  @Permissions('blog.manage')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBlogPostDto) {
    return this.blogPostsService.create(user.storeId, dto, user);
  }

  @Permissions('blog.manage')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryBlogPostDto) {
    return this.blogPostsService.findAll(user.storeId, query);
  }

  @Permissions('blog.manage')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.blogPostsService.findOne(user.storeId, id);
  }

  @Permissions('blog.manage')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBlogPostDto,
  ) {
    return this.blogPostsService.update(user.storeId, id, dto, user);
  }

  @Permissions('blog.manage')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MULTER_HARD_CEILING_BYTES, files: 1 } }))
  @Post(':id/cover-image')
  uploadCoverImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.blogPostsService.uploadCoverImage(user.storeId, id, file, user);
  }

  @Permissions('blog.manage')
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.blogPostsService.remove(user.storeId, id, user);
  }
}
