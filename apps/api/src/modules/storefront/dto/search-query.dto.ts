import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { MAX_PAGE_SIZE } from '../../../common/dto/pagination-query.dto';

const SORT_OPTIONS = ['relevance', 'newest', 'price_asc', 'price_desc', 'name_asc', 'name_desc'] as const;
export type SearchSortOption = (typeof SORT_OPTIONS)[number];

const AVAILABILITY_OPTIONS = ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const;
export type SearchAvailabilityFilter = (typeof AVAILABILITY_OPTIONS)[number];

/**
 * `/storefront/search`'s query contract. Deliberately its own DTO rather than
 * extending PublicProductQueryDto - a search request keys its keyword as `q`
 * (per §4 of the Phase 12 spec) and its own `sortBy` whitelist includes
 * `relevance`, which only means something when `q` is present (falls back to
 * `newest` when it is not - see StorefrontSearchService).
 */
export class SearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'q must be at most 200 characters' })
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = 24;

  @IsOptional()
  @IsIn(SORT_OPTIONS)
  sortBy?: SearchSortOption = 'relevance';

  @IsOptional()
  @IsString()
  categorySlug?: string;

  @IsOptional()
  @IsString()
  brandSlug?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsIn(AVAILABILITY_OPTIONS)
  availability?: SearchAvailabilityFilter;

  // Comma-separated attribute value ids, e.g. "?attributeValueIds=uuid1,uuid2".
  // A product qualifies only if it has one ACTIVE, non-deleted variant that
  // carries every listed value simultaneously (narrowing facet semantics),
  // never merely "any variant matches any one of them" - see
  // StorefrontSearchService's doc comment on this.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : value))
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  attributeValueIds?: string[];
}
