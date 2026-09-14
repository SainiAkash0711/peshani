import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { StorefrontBlogService } from './storefront-blog.service';
import { PublicBlogPostQueryDto } from './dto/public-blog-post-query.dto';

@ApiTags('storefront')
@Controller('storefront/blog-posts')
export class StorefrontBlogController {
  constructor(
    private readonly storeSettingsService: StoreSettingsService,
    private readonly blogService: StorefrontBlogService,
  ) {}

  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @Get()
  async findAll(@Query() query: PublicBlogPostQueryDto) {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.blogService.findPublished(store.id, query);
  }

  // Declared before ':slug' - a static path must be matched first or Nest
  // would treat "sidebar" as a slug value (same reasoning as the admin
  // HomepageSlidesController's 'reorder' route).
  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @Get('sidebar')
  async sidebar() {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.blogService.getSidebar(store.id);
  }

  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @Get(':slug')
  async findOne(@Param('slug') slug: string) {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.blogService.findPublishedBySlug(store.id, slug);
  }
}
