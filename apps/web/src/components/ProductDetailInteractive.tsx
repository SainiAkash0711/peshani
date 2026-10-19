'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import type { ProductDetail } from '../types/catalog';
import { discountPercent, formatPrice } from '../lib/format';
import { useCart } from '../lib/cart-context';
import { isAllowedImageUrl } from '../lib/safe-image';
import { AvailabilityBadge } from './AvailabilityBadge';
import { VariantSelector } from './VariantSelector';
import { WishlistButton } from './WishlistButton';
import { ProductReviews } from './ProductReviews';

const DESCRIPTION_PREVIEW_CHARS = 420;

interface ProductDetailInteractiveProps {
  product: ProductDetail;
  currencySymbol?: string;
  returnWindowDays?: number;
  supportPhone?: string;
}

export function ProductDetailInteractive({ product, currencySymbol, returnWindowDays, supportPhone }: ProductDetailInteractiveProps) {
  const [activeVariant, setActiveVariant] = useState<ProductDetail['variants'][number] | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [isAdding, setIsAdding] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [buyBoxVisible, setBuyBoxVisible] = useState(true);
  const buyBoxRef = useRef<HTMLDivElement>(null);
  const { addItem } = useCart();

  useEffect(() => {
    const el = buyBoxRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setBuyBoxVisible(entry.isIntersecting), { threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const images = useMemo(() => {
    const source = activeVariant?.images.length ? activeVariant.images : product.images;
    // A disallowed image host must never be handed to next/image at all - it
    // throws uncaught and crashes the whole page, not just this gallery.
    return source.filter((image) => isAllowedImageUrl(image.url));
  }, [activeVariant, product.images]);

  const currentImage = images[activeImageIndex] ?? images[0] ?? null;
  const simpleDiscount = discountPercent(product.basePrice, product.compareAtPrice);
  const isLongDescription = (product.description?.length ?? 0) > DESCRIPTION_PREVIEW_CHARS;

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
        {product.brand && <p className="pdp__brand">{product.brand.name}</p>}
        {product.shortDescription && <p className="pdp__short">{product.shortDescription}</p>}
        {product.productType === 'SIMPLE' ? (
          <div className="pdp__price-block">
            <div className="pdp__price">
              {formatPrice(product.basePrice, currencySymbol)}
              {product.compareAtPrice && <span className="card__price-compare">{formatPrice(product.compareAtPrice, currencySymbol)}</span>}
              {simpleDiscount && <span className="pdp__save">Save {simpleDiscount}%</span>}
            </div>
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

          const buttonLabel = needsSelection
            ? 'Select an option'
            : availability === 'OUT_OF_STOCK'
              ? 'Out of stock'
              : isAdding
                ? 'Adding…'
                : 'Add to Cart';

          return (
            <>
              <div className="pdp__add-to-cart" ref={buyBoxRef}>
                <div className="pdp__quantity-stepper">
                  <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">
                    −
                  </button>
                  <span aria-live="polite">{quantity}</span>
                  <button type="button" onClick={() => setQuantity((q) => q + 1)} aria-label="Increase quantity">
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className="btn pdp__cart-btn"
                  disabled={!canAddToCart || isAdding}
                  onClick={() => void handleAddToCart()}
                >
                  {buttonLabel}
                </button>
              </div>

              <div className={`pdp__sticky${buyBoxVisible ? '' : ' is-visible'}`} aria-hidden={buyBoxVisible}>
                <div className="pdp__sticky-info">
                  <span className="pdp__sticky-name">{product.name}</span>
                  <span className="pdp__sticky-price">
                    {formatPrice(activeVariant?.price ?? product.priceRange?.min ?? product.basePrice, currencySymbol)}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn pdp__cart-btn"
                  tabIndex={buyBoxVisible ? -1 : 0}
                  disabled={!canAddToCart || isAdding}
                  onClick={() => void handleAddToCart()}
                >
                  {buttonLabel}
                </button>
              </div>
            </>
          );
        })()}

        <ul className="pdp__assurances">
          <li>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M12 2 4 5v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5l-8-3Zm-1.2 13.4-3-3 1.4-1.4 1.6 1.6 4.6-4.6 1.4 1.4-6 6Z" fill="currentColor" />
            </svg>
            <span>
              <strong>Secure payments</strong>
              <small>Your payment details are encrypted</small>
            </span>
          </li>
          {returnWindowDays ? (
            <li>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M6 8h9a5 5 0 0 1 0 10h-3v-2h3a3 3 0 0 0 0-6H6.83l2.58 2.59L8 14 3 9l5-5 1.41 1.41L6.83 8Z" fill="currentColor" />
              </svg>
              <span>
                <strong>{returnWindowDays}-day returns</strong>
                <small>Request a return from your orders page</small>
              </span>
            </li>
          ) : null}
          {supportPhone && (
            <li>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.2 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.3Z" fill="currentColor" />
              </svg>
              <span>
                <strong>Questions? We&apos;re on WhatsApp</strong>
                <small>
                  <a href={`https://wa.me/${supportPhone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">
                    Chat with our team
                  </a>
                </small>
              </span>
            </li>
          )}
        </ul>

        {product.description && (
          <section className="pdp__details">
            <h2>Product details</h2>
            <div className={`pdp__description${isLongDescription && !descriptionOpen ? ' is-clamped' : ''}`}>
              {product.description}
            </div>
            {isLongDescription && (
              <button type="button" className="pdp__more" onClick={() => setDescriptionOpen((open) => !open)} aria-expanded={descriptionOpen}>
                {descriptionOpen ? 'Show less' : 'Read more'}
              </button>
            )}
          </section>
        )}
      </div>
    </div>
    <ProductReviews productId={product.id} />
    </>
  );
}
