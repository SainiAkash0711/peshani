import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { ReviewsService } from './reviews.service';
import { QueryAdminReviewsDto } from './dto/query-admin-reviews.dto';
import { ModerateReviewDto } from './dto/moderate-review.dto';

@ApiTags('admin-reviews')
@UseGuards(PermissionsGuard)
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Permissions('review.read')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryAdminReviewsDto) {
    return this.reviewsService.findAllForAdmin(user.storeId, query);
  }

  @Permissions('review.read')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviewsService.findOneForAdmin(user.storeId, id);
  }

  @Permissions('review.moderate')
  @Patch(':id/moderate')
  moderate(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerateReviewDto) {
    return this.reviewsService.moderate(user.storeId, user, id, dto);
  }

  @Permissions('review.delete')
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviewsService.removeAsAdmin(user.storeId, user, id);
  }
}
