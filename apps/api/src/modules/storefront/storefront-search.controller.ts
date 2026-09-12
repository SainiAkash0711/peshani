import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { throttleLimit } from '../../common/utils/throttle.util';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { StorefrontSearchService } from './storefront-search.service';
import { SearchQueryDto } from './dto/search-query.dto';

/**
 * `/storefront/search` is read-only and never mutates inventory. Cache-
 * Control is intentionally short (public, max-age=30) rather than the 60s
 * used for plain listings - keyword combinations are far more varied and
 * far less worth caching at any shared layer, and the master prompt's own
 * SEO guidance (a `q`-bearing page is `noindex, follow`) means this route
 * gets no benefit from a longer, crawler-friendly cache window either.
 * Rate-limited more tightly than the global default since a full-text-style
 * relevance query is more expensive than a plain filtered listing.
 */
@ApiTags('storefront')
@Controller('storefront/search')
export class StorefrontSearchController {
  constructor(
    private readonly storeSettingsService: StoreSettingsService,
    private readonly searchService: StorefrontSearchService,
  ) {}

  @Public()
  @Throttle({ default: { limit: throttleLimit(60), ttl: 60_000 } })
  @Header('Cache-Control', 'public, max-age=30')
  @Get()
  async search(@Query() query: SearchQueryDto) {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.searchService.search(store.id, query);
  }
}
