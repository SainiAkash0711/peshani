import { Body, Controller, Delete, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReportReviewDto } from './dto/report-review.dto';
import { throttleLimit } from '../../common/utils/throttle.util';

/**
 * No @Public() anywhere - every route requires the authenticated customer
 * whose identity comes from the JWT alone (§2 principles 2-4). storeId is
 * likewise always read from the JWT (user.storeId), never accepted from
 * the client.
 */
@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Throttle({ default: { limit: throttleLimit(10), ttl: 60_000 } })
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReviewDto) {
    return this.reviewsService.create(user.storeId, user, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReviewDto) {
    return this.reviewsService.update(user.storeId, user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviewsService.remove(user.storeId, user, id);
  }

  @Post(':id/helpful')
  addHelpful(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviewsService.addHelpfulVote(user.storeId, user, id);
  }

  @Delete(':id/helpful')
  removeHelpful(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviewsService.removeHelpfulVote(user.storeId, user, id);
  }

  @Throttle({ default: { limit: throttleLimit(10), ttl: 60_000 } })
  @Post(':id/report')
  report(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportReviewDto) {
    return this.reviewsService.report(user.storeId, user, id, dto);
  }
}
