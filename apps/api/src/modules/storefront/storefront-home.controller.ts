import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { StorefrontHomeService } from './storefront-home.service';

@ApiTags('storefront')
@Controller('storefront/home')
export class StorefrontHomeController {
  constructor(
    private readonly storeSettingsService: StoreSettingsService,
    private readonly homeService: StorefrontHomeService,
  ) {}

  @Public()
  // Short cache (not the 60s previously used elsewhere on this storefront):
  // this payload includes the admin-managed homepage slider, which an admin
  // expects to see reflected quickly after adding/editing/deleting a slide,
  // not up to a full minute later.
  @Header('Cache-Control', 'public, max-age=10')
  @Get()
  async getHomePage() {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.homeService.getHomePage(store.id);
  }
}
