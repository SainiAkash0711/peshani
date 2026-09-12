import Link from 'next/link';
import Image from 'next/image';
import type { ProductListItem } from '../types/catalog';
import { formatPrice } from '../lib/format';
import { isAllowedImageUrl } from '../lib/safe-image';
import { AvailabilityBadge } from './AvailabilityBadge';
import { WishlistButton } from './WishlistButton';

export function ProductCard({ product, currencySymbol }: { product: ProductListItem; currencySymbol?: string }) {
  return (
    <Link href={`/products/${product.slug}`} className="card" style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1, background: 'var(--color-surface, #fff)', borderRadius: '50%' }}>
        <WishlistButton productId={product.id} />
      </div>
      <div className="card__media">
        {product.primaryImage && isAllowedImageUrl(product.primaryImage.url) ? (
          <Image
            src={product.primaryImage.url}
            alt={product.primaryImage.altText ?? product.name}
            fill
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 220px"
          />
        ) : (
          <span className="card__media--empty">No image</span>
        )}
      </div>
      <div className="card__body">
        {product.brand && <span className="card__brand">{product.brand.name}</span>}
        <span className="card__name">{product.name}</span>
        <div className="card__price">
          {product.priceRange ? (
            <span className="card__price-current">
              {formatPrice(product.priceRange.min, currencySymbol)} - {formatPrice(product.priceRange.max, currencySymbol)}
            </span>
          ) : (
            <>
              <span className="card__price-current">{formatPrice(product.basePrice, currencySymbol)}</span>
              {product.compareAtPrice && (
                <span className="card__price-compare">{formatPrice(product.compareAtPrice, currencySymbol)}</span>
              )}
            </>
          )}
        </div>
        <AvailabilityBadge availability={product.availability} />
      </div>
    </Link>
  );
}
