import { apiClient } from './api-client';
import { PromotionDetail, PromotionSummary } from '../types/promotions';

export interface EntityOption {
  id: string;
  name: string;
}

/**
 * Resolves a list of bare entity ids (as returned by GET /promotions/:id) into
 * {id, name} pairs by hitting each resource's detail endpoint. Promotions only
 * store ids, so a friendly picker needs this to show names instead of uuids.
 * Any id that fails to resolve (e.g. the product was since deleted) is
 * silently dropped rather than blocking the whole form from opening.
 */
export async function resolveEntityOptions(resourceUrl: string, ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const results = await Promise.all(
    ids.map((id) =>
      apiClient
        .get<{ id: string; name: string }>(`${resourceUrl}/${id}`)
        .then((entity) => ({ id: entity.id, name: entity.name }))
        .catch(() => null),
    ),
  );
  return results.filter((r): r is EntityOption => r !== null);
}

export interface HydratedPromotion extends PromotionSummary {
  productIds: EntityOption[];
  excludedProductIds: EntityOption[];
  categoryIds: EntityOption[];
  excludedCategoryIds: EntityOption[];
  brandIds: EntityOption[];
  excludedBrandIds: EntityOption[];
}

export async function hydratePromotionDetail(detail: PromotionDetail): Promise<HydratedPromotion> {
  const [productIds, excludedProductIds, categoryIds, excludedCategoryIds, brandIds, excludedBrandIds] =
    await Promise.all([
      resolveEntityOptions('/products', detail.productIds),
      resolveEntityOptions('/products', detail.excludedProductIds),
      resolveEntityOptions('/categories', detail.categoryIds),
      resolveEntityOptions('/categories', detail.excludedCategoryIds),
      resolveEntityOptions('/brands', detail.brandIds),
      resolveEntityOptions('/brands', detail.excludedBrandIds),
    ]);
  return { ...detail, productIds, excludedProductIds, categoryIds, excludedCategoryIds, brandIds, excludedBrandIds };
}
