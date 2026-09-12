import { Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { NotificationService } from './notification.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';

/**
 * §20 - customer in-app notification history/read-state. No @Public()
 * anywhere - storeId/userId always come from the JWT via @CurrentUser(),
 * never the client, exactly like every other customer-scoped controller in
 * this codebase (WishlistController, ReviewsController).
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryNotificationsDto) {
    return this.notificationService.getUserNotifications(user.storeId, user.userId, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationService.getUnreadCount(user.storeId, user.userId);
  }

  @Patch(':id/read')
  markAsRead(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notificationService.markAsRead(user.storeId, user.userId, id);
  }

  @Patch('read-all')
  markAllAsRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationService.markAllAsRead(user.storeId, user.userId);
  }
}
