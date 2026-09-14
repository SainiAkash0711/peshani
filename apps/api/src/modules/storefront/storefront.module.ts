import { Module } from '@nestjs/common';
import { StoreSettingsModule } from '../store-settings/store-settings.module';
import { HomepageSlidesModule } from '../homepage-slides/homepage-slides.module';
import { StorefrontProductsController } from './storefront-products.controller';
import { StorefrontCategoriesController } from './storefront-categories.controller';
import { StorefrontBrandsController } from './storefront-brands.controller';
import { StorefrontHomeController } from './storefront-home.controller';
import { StorefrontSearchController } from './storefront-search.controller';
import { StorefrontSitemapController } from './storefront-sitemap.controller';
import { StorefrontBlogController } from './storefront-blog.controller';
import { StorefrontProductsService } from './storefront-products.service';
import { StorefrontCategoriesService } from './storefront-categories.service';
import { StorefrontBrandsService } from './storefront-brands.service';
import { StorefrontHomeService } from './storefront-home.service';
import { StorefrontInventoryService } from './storefront-inventory.service';
import { StorefrontSearchService } from './storefront-search.service';
import { StorefrontSitemapService } from './storefront-sitemap.service';
import { StorefrontBlogService } from './storefront-blog.service';

/**
 * Read-only public storefront surface (Phase 3): products, categories,
 * brands, home page. No Cart/Checkout/Orders/Payments controller or route
 * lives here - see the Phase 3 final report's explicit scope-boundary
 * confirmation. StorefrontInventoryService is exported so CartModule (Phase
 * 4) can reuse its bulk-availability lookup instead of duplicating inventory
 * calculations - that export is the only cross-module surface this module
 * exposes.
 */
@Module({
  imports: [StoreSettingsModule, HomepageSlidesModule],
  controllers: [
    StorefrontProductsController,
    StorefrontCategoriesController,
    StorefrontBrandsController,
    StorefrontHomeController,
    StorefrontSearchController,
    StorefrontSitemapController,
    StorefrontBlogController,
  ],
  providers: [
    StorefrontProductsService,
    StorefrontCategoriesService,
    StorefrontBrandsService,
    StorefrontHomeService,
    StorefrontInventoryService,
    StorefrontSearchService,
    StorefrontSitemapService,
    StorefrontBlogService,
  ],
  exports: [StorefrontInventoryService],
})
export class StorefrontModule {}
