'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import type { ProductDetail } from '../types/catalog';
import { formatPrice } from '../lib/format';
import { useCart } from '../lib/cart-context';
import { isAllowedImageUrl } from '../lib/safe-image';
import { AvailabilityBadge } from './AvailabilityBadge';
import { VariantSelector } from './VariantSelector';
import { WishlistButton } from './WishlistButton';
import { ProductReviews } from './ProductReviews';

export function ProductDetailInteractive({ product, currencySymbol }: { product: ProductDetail; currencySymbol?: string }) {
  const [activeVariant, setActiveVariant] = useState<ProductDetail['variants'][number] | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [isAdding, setIsAdding] = useState(false);
  const { addItem } = useCart();

  const images = useMemo(() => {
    const source = activeVariant?.images.length ? activeVariant.images : product.images;
    // A disallowed image host must never be handed to next/image at all - it
    // throws uncaught and crashes the whole page, not just this gallery.
    return source.filter((image) => isAllowedImageUrl(image.url));
  }, [activeVariant, product.images]);

  const currentImage = images[activeImageIndex] ?? images[0] ?? null;

  return (
    <>
    <div className="pdp">
      <div>
        <div className="pdp__gallery-main">
          {currentImage ? (
            <div className="pdp__gallery-image" key={currentImage.url}>
              <Image
                src={currentImage.url}
                alt={currentImage.altText ?? product.name}
                fill
                sizes="(max-width: 800px) 100vw, 50vw"
                priority
              />
            </div>
          ) : (
            <span className="card__media--empty">No image available</span>
          )}
        </div>
        {images.length > 1 && (
          <div className="pdp__thumbs">
            {images.map((image, index) => (
              <button
                key={image.url + index}
                type="button"
                className={`pdp__thumb${index === activeImageIndex ? ' is-active' : ''}`}
                onClick={() => setActiveImageIndex(index)}
                aria-label={`View image ${index + 1}`}
              >
                <Image src={image.url} alt={image.altText ?? ''} width={64} height={64} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <h1 className="pdp__title">{product.name}</h1>
          <WishlistButton productId={product.id} variantId={activeVariant?.id ?? null} />
        </div>
        {product.brand && <p style={{ color: 'var(--color-text-muted)' }}>{product.brand.name}</p>}
        {product.productType === 'SIMPLE' ? (
          <div className="pdp__price">
            {formatPrice(product.basePrice, currencySymbol)}
            {product.compareAtPrice && <span className="card__price-compare">{formatPrice(product.compareAtPrice, currencySymbol)}</span>}
            <AvailabilityBadge availability={product.availability} />
          </div>
        ) : (
          <VariantSelector
            product={product}
            currencySymbol={currencySymbol}
            onVariantChange={(variant) => {
              setActiveVariant(variant);
              setActiveImageIndex(0);
            }}
          />
        )}

        {(() => {
          const isVariable = product.productType === 'VARIABLE';
          const needsSelection = isVariable && !activeVariant;
          const availability = isVariable ? activeVariant?.availability : product.availability;
          const canAddToCart = !needsSelection && availability !== 'OUT_OF_STOCK';

          async function handleAddToCart() {
            setIsAdding(true);
            await addItem(product.id, isVariable ? activeVariant?.id : undefined, quantity);
            setIsAdding(false);
          }

          return (
            <div className="pdp__add-to-cart">
              <div className="pdp__quantity-stepper">
                <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">
                  -
                </button>
                <span>{quantity}</span>
                <button type="button" onClick={() => setQuantity((q) => q + 1)} aria-label="Increase quantity">
                  +
                </button>
              </div>
              <button type="button" className="btn" disabled={!canAddToCart || isAdding} onClick={() => void handleAddToCart()}>
                {needsSelection ? 'Select an option' : isAdding ? 'Adding…' : 'Add to Cart'}
              </button>
            </div>
          );
        })()}

        {product.description && <div className="pdp__description">{product.description}</div>}
      </div>
    </div>
    <ProductReviews productId={product.id} />
    </>
  );
}
