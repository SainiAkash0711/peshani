import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { StorefrontBrandsService } from './storefront-brands.service';
import { StorefrontProductsService } from './storefront-products.service';
import { PublicProductQueryDto } from './dto/public-product-query.dto';

@ApiTags('storefront')
@Controller('storefront/brands')
export class StorefrontBrandsController {
  constructor(
    private readonly storeSettingsService: StoreSettingsService,
    private readonly brandsService: StorefrontBrandsService,
    private readonly productsService: StorefrontProductsService,
  ) {}

  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @Get()
  async findAll(@Query() query: PaginationQueryDto) {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.brandsService.findAll(store.id, query);
  }

  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @Get(':slug')
  async findOne(@Param('slug') slug: string) {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.brandsService.getBySlugOrThrow(store.id, slug);
  }

  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @Get(':slug/products')
  async findProducts(@Param('slug') slug: string, @Query() query: PublicProductQueryDto) {
    const store = await this.storeSettingsService.getDefaultStore();
    const brand = await this.brandsService.getBySlugOrThrow(store.id, slug);
    return this.productsService.findByBrandId(store.id, brand.id, query);
  }
}
