import { Module } from '@nestjs/common';
import { StoreSettingsModule } from '../store-settings/store-settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  imports: [StoreSettingsModule, NotificationsModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
