import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { StorefrontCategoriesService } from './storefront-categories.service';
import { StorefrontProductsService } from './storefront-products.service';
import { PublicProductQueryDto } from './dto/public-product-query.dto';

@ApiTags('storefront')
@Controller('storefront/categories')
export class StorefrontCategoriesController {
  constructor(
    private readonly storeSettingsService: StoreSettingsService,
    private readonly categoriesService: StorefrontCategoriesService,
    private readonly productsService: StorefrontProductsService,
  ) {}

  @Public()
  // Short cache: feeds the homepage mega menu, which should reflect an
  // admin category/subcategory add-rename-delete quickly (see the
  // homepage slider's identical reasoning for its own short cache).
  @Header('Cache-Control', 'public, max-age=30')
  @Get()
  async findAll() {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.categoriesService.getTree(store.id);
  }

  @Public()
  @Header('Cache-Control', 'public, max-age=30')
  @Get(':slug')
  async findOne(@Param('slug') slug: string) {
    const store = await this.storeSettingsService.getDefaultStore();
    const { parentId: _parentId, ...category } = await this.categoriesService.getBySlugOrThrow(store.id, slug);
    const [breadcrumbs, children] = await Promise.all([
      this.categoriesService.getBreadcrumbs(store.id, category.id),
      this.categoriesService.getChildren(store.id, category.id),
    ]);
    return { ...category, breadcrumbs, children };
  }

  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @Get(':slug/products')
  async findProducts(@Param('slug') slug: string, @Query() query: PublicProductQueryDto) {
    const store = await this.storeSettingsService.getDefaultStore();
    const category = await this.categoriesService.getBySlugOrThrow(store.id, slug);
    return this.productsService.findByCategoryId(store.id, category.id, query);
  }
}
