import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ContactService } from './contact.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';
import { CreateContactReplyDto } from './dto/create-contact-reply.dto';

@ApiTags('contact')
@UseGuards(PermissionsGuard)
@Controller()
export class ContactController {
  constructor(
    private readonly contactService: ContactService,
    private readonly storeSettingsService: StoreSettingsService,
  ) {}

  @Public()
  @Post('storefront/contact')
  async create(@Body() dto: CreateContactMessageDto) {
    const store = await this.storeSettingsService.getDefaultStore();
    await this.contactService.create(store.id, dto);
    // Never echoes back whether the notification email actually sent - a
    // customer submitting the form only needs to know their message was
    // received, not the store's SMTP configuration state.
    return { received: true };
  }

  @Permissions('contact_message.read')
  @Get('admin/contact-messages')
  async findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.contactService.findAll(user.storeId, query);
  }

  @Permissions('contact_message.read')
  @Get('admin/contact-messages/:id')
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.contactService.findOne(user.storeId, id);
  }

  @Permissions('contact_message.reply')
  @Post('admin/contact-messages/:id/reply')
  async reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateContactReplyDto,
  ) {
    return this.contactService.reply(user.storeId, id, dto, user);
  }

  @Permissions('contact_message.delete')
  @Delete('admin/contact-messages/:id')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.contactService.remove(user.storeId, id, user);
  }
}
