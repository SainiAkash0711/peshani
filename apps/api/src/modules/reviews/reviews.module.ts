import { Module } from '@nestjs/common';
import { StoreSettingsModule } from '../store-settings/store-settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { PublicReviewsController } from './public-reviews.controller';
import { AdminReviewsController } from './admin-reviews.controller';

@Module({
  imports: [StoreSettingsModule, NotificationsModule],
  controllers: [ReviewsController, PublicReviewsController, AdminReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
