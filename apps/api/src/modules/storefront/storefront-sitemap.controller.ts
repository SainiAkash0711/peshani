import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { StorefrontSitemapService } from './storefront-sitemap.service';

class SitemapProductsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  // Overridable (bounded) purely so this can be exercised with a small
  // fixture set in tests without requiring hundreds of rows - the real
  // sitemap generator can also use this to tune its own batch size, never
  // beyond the same 500-row ceiling the default already uses.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

@ApiTags('storefront')
@Controller('storefront/sitemap')
export class StorefrontSitemapController {
  constructor(
    private readonly storeSettingsService: StoreSettingsService,
    private readonly sitemapService: StorefrontSitemapService,
  ) {}

  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @Get('products')
  async products(@Query() query: SitemapProductsQueryDto) {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.sitemapService.getProductsPage(store.id, query.cursor, query.limit);
  }

  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @Get('categories')
  async categories() {
    const store = await this.storeSettingsService.getDefaultStore();
    return { items: await this.sitemapService.getAllCategories(store.id) };
  }

  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @Get('brands')
  async brands() {
    const store = await this.storeSettingsService.getDefaultStore();
    return { items: await this.sitemapService.getAllBrands(store.id) };
  }
}
