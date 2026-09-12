'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { HomepageSlide } from '../types/catalog';
import { isAllowedImageUrl } from '../lib/safe-image';

const AUTOPLAY_INTERVAL_MS = 5000;

export function HeroSlider({ slides: allSlides }: { slides: HomepageSlide[] }) {
  const [index, setIndex] = useState(0);
  // A disallowed image host must never be handed to next/image at all - it
  // throws uncaught and crashes the whole homepage, not just the slider.
  const slides = allSlides.filter((s) => isAllowedImageUrl(s.imageUrl));

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % slides.length), AUTOPLAY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [slides.length]);

  if (slides.length === 0) return null;

  return (
    <div className="hero-slider">
      {slides.map((slide, i) => {
        const isActive = i === index;
        const content = (
          <div className={`hero-slider__slide${isActive ? ' hero-slider__slide--active' : ''}`} aria-hidden={!isActive}>
            <div className="hero-slider__image-wrap">
              <Image src={slide.imageUrl} alt={slide.title ?? ''} fill sizes="100vw" priority={i === 0} style={{ objectFit: 'cover' }} />
            </div>
            {(slide.title || slide.subtitle) && (
              <div className="hero-slider__caption" key={isActive ? `active-${i}` : i}>
                {slide.title && <h2>{slide.title}</h2>}
                {slide.subtitle && <p>{slide.subtitle}</p>}
              </div>
            )}
          </div>
        );
        return (
          <div key={slide.id} className="hero-slider__slide-slot" style={{ opacity: isActive ? 1 : 0, pointerEvents: isActive ? 'auto' : 'none' }}>
            {slide.linkUrl ? <Link href={slide.linkUrl}>{content}</Link> : content}
          </div>
        );
      })}

      {slides.length > 1 && (
        <>
          <button
            type="button"
            className="hero-slider__arrow hero-slider__arrow--prev"
            aria-label="Previous slide"
            onClick={() => setIndex((i) => (i - 1 + slides.length) % slides.length)}
          >
            ‹
          </button>
          <button
            type="button"
            className="hero-slider__arrow hero-slider__arrow--next"
            aria-label="Next slide"
            onClick={() => setIndex((i) => (i + 1) % slides.length)}
          >
            ›
          </button>
          <div className="hero-slider__dots">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={`hero-slider__dot${i === index ? ' hero-slider__dot--active' : ''}`}
                aria-label={`Go to slide ${i + 1}`}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
