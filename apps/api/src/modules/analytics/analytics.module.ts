import { Module } from '@nestjs/common';
import { StoreSettingsModule } from '../store-settings/store-settings.module';
import { AnalyticsService } from './analytics.service';
import { AdminAnalyticsController } from './admin-analytics.controller';

@Module({
  imports: [StoreSettingsModule],
  controllers: [AdminAnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
