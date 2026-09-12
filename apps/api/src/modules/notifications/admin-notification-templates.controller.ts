import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { NotificationTemplateService } from './notification-template.service';
import { CreateNotificationTemplateDto } from './dto/create-notification-template.dto';
import { UpdateNotificationTemplateDto } from './dto/update-notification-template.dto';
import { SetTemplateStatusDto } from './dto/set-template-status.dto';

@ApiTags('admin-notification-templates')
@UseGuards(PermissionsGuard)
@Controller('admin/notification-templates')
export class AdminNotificationTemplatesController {
  constructor(private readonly templateService: NotificationTemplateService) {}

  @Permissions('notification_template.read')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.templateService.findAll(user.storeId);
  }

  @Permissions('notification_template.read')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.templateService.findOne(user.storeId, id);
  }

  @Permissions('notification_template.create')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateNotificationTemplateDto) {
    return this.templateService.create(user.storeId, user, dto);
  }

  @Permissions('notification_template.update')
  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNotificationTemplateDto) {
    return this.templateService.update(user.storeId, user, id, dto);
  }

  @Permissions('notification_template.status')
  @Patch(':id/status')
  setStatus(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetTemplateStatusDto) {
    return this.templateService.setStatus(user.storeId, user, id, dto.isActive);
  }

  @Permissions('notification_template.delete')
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.templateService.remove(user.storeId, user, id);
  }
}
