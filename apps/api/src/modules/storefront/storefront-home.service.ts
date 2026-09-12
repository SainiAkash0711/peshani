import { Injectable } from '@nestjs/common';
import { StorefrontProductsService } from './storefront-products.service';
import { StorefrontCategoriesService } from './storefront-categories.service';
import { StorefrontBrandsService } from './storefront-brands.service';
import { HomepageSlidesService } from '../homepage-slides/homepage-slides.service';

const HOME_SECTION_LIMIT = 8;
const HOME_CATEGORY_LIMIT = 8;

@Injectable()
export class StorefrontHomeService {
  constructor(
    private readonly productsService: StorefrontProductsService,
    private readonly categoriesService: StorefrontCategoriesService,
    private readonly brandsService: StorefrontBrandsService,
    private readonly homepageSlidesService: HomepageSlidesService,
  ) {}

  async getHomePage(storeId: string) {
    const [featuredProducts, bestsellers, newArrivals, featuredCategories, brands, slides] = await Promise.all([
      this.productsService.getFeatured(storeId, HOME_SECTION_LIMIT),
      this.productsService.getBestsellers(storeId, HOME_SECTION_LIMIT),
      this.productsService.getNewArrivals(storeId, HOME_SECTION_LIMIT),
      this.categoriesService.getFeatured(storeId, HOME_CATEGORY_LIMIT),
      this.brandsService.findAll(storeId, { page: 1, pageSize: HOME_CATEGORY_LIMIT, sortOrder: 'asc' }),
      this.homepageSlidesService.findActiveForStorefront(storeId),
    ]);

    return {
      slides,
      featuredProducts,
      bestsellers,
      newArrivals,
      featuredCategories,
      brands: brands.items,
    };
  }
}
