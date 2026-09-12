import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { NotificationPreferenceService } from './notification-preference.service';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';

/**
 * §21 - only the authenticated customer may read or change their own
 * preferences. storeId/userId always come from the JWT - the DTO does not
 * even declare userId/storeId fields, so nothing in the request body could
 * ever be trusted as identity even if a client tried to send one (§21/§28).
 */
@ApiTags('notification-preferences')
@Controller('notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly preferenceService: NotificationPreferenceService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.preferenceService.getForUser(user.storeId, user.userId);
  }

  @Patch()
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateNotificationPreferencesDto) {
    return this.preferenceService.updateForUser(user.storeId, user.userId, dto);
  }
}
