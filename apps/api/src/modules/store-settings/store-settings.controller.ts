import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { StoreSettingsService } from './store-settings.service';
import { UpdateStoreSettingDto } from './dto/update-store-setting.dto';

@ApiTags('store-settings')
@Controller('store-settings')
export class StoreSettingsController {
  constructor(private readonly storeSettingsService: StoreSettingsService) {}

  @Public()
  @Get()
  async getPublicSettings() {
    const store = await this.storeSettingsService.getDefaultStore();
    const settings = await this.storeSettingsService.getAllSettings(store.id);
    return { storeName: store.name, ...settings };
  }

  @UseGuards(PermissionsGuard)
  @Permissions('settings.store.manage')
  @Put()
  async updateSetting(@Body() dto: UpdateStoreSettingDto) {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.storeSettingsService.upsertSetting(store.id, dto.key, dto.value);
  }
}
