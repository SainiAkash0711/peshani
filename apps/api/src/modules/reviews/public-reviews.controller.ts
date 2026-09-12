import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { ReviewsService } from './reviews.service';
import { QueryReviewsDto } from './dto/query-reviews.dto';

/**
 * Public storefront reviews (§10/§11) - a standalone controller (not nested
 * inside the existing, permission-gated admin ProductsController) so a
 * public, unauthenticated surface never shares a class with admin-only
 * routes. Mirrors the storefront module's own @Public() + getDefaultStore()
 * pattern (see StorefrontBrandsController) for resolving storeId without a JWT.
 */
@ApiTags('reviews')
@Controller('products/:productId/reviews')
export class PublicReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly storeSettingsService: StoreSettingsService,
  ) {}

  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @Get()
  async findAll(@Param('productId') productId: string, @Query() query: QueryReviewsDto) {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.reviewsService.findPublicForProduct(store.id, productId, query);
  }

  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @Get('summary')
  async summary(@Param('productId') productId: string) {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.reviewsService.getRatingSummary(store.id, productId);
  }
}
