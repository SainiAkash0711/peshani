import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { StorefrontProductsService } from './storefront-products.service';
import { PublicProductQueryDto } from './dto/public-product-query.dto';

/**
 * Every route here is @Public() and resolves its own store via
 * StoreSettingsService.getDefaultStore() (the same pattern
 * StoreSettingsController's public GET already uses) - never from a client-
 * supplied id, and never behind the admin PermissionsGuard.
 */
@ApiTags('storefront')
@Controller('storefront/products')
export class StorefrontProductsController {
  constructor(
    private readonly storeSettingsService: StoreSettingsService,
    private readonly productsService: StorefrontProductsService,
  ) {}

  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @Get()
  async findAll(@Query() query: PublicProductQueryDto) {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.productsService.findProducts(store.id, query);
  }

  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @Get(':slug')
  async findOne(@Param('slug') slug: string) {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.productsService.getBySlug(store.id, slug);
  }
}
