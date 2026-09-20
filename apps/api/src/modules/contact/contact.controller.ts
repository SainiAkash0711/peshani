import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ContactService } from './contact.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

@ApiTags('contact')
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

  @UseGuards(PermissionsGuard)
  @Permissions('contact_message.read')
  @Get('admin/contact-messages')
  async findAll(@Query() query: PaginationQueryDto) {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.contactService.findAll(store.id, query);
  }
}
