import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { NotificationService } from './notification.service';
import { QueryAdminNotificationsDto } from './dto/query-admin-notifications.dto';

@ApiTags('admin-notifications')
@UseGuards(PermissionsGuard)
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Permissions('notification.read')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryAdminNotificationsDto) {
    return this.notificationService.findAllForAdmin(user.storeId, query);
  }

  @Permissions('notification.read')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notificationService.findOneForAdmin(user.storeId, id);
  }
}
