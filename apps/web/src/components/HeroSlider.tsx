'use client';

import { KeyboardEvent, PointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { HomepageSlide } from '../types/catalog';
import { isAllowedImageUrl } from '../lib/safe-image';

const AUTOPLAY_INTERVAL_MS = 6500;
const SWIPE_THRESHOLD_PX = 40;

interface CategoryRef {
  name: string;
  slug: string;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Slides without an explicit link fall back to the category whose name
// matches the slide title, so a banner that says "Shop now" always leads
// somewhere relevant instead of being a dead image.
function resolveHref(slide: HomepageSlide, categories: CategoryRef[]): string {
  if (slide.linkUrl) return slide.linkUrl;
  if (slide.title) {
    const title = normalize(slide.title);
    const exact = categories.find((c) => normalize(c.name) === title);
    if (exact) return `/categories/${exact.slug}`;
    const firstWord = title.split(' ')[0];
    const partial = categories.find((c) => normalize(c.name).split(' ')[0] === firstWord);
    if (partial) return `/categories/${partial.slug}`;
  }
  return '/products';
}

export function HeroSlider({ slides: allSlides, categories = [] }: { slides: HomepageSlide[]; categories?: CategoryRef[] }) {
  // A disallowed image host must never be handed to next/image at all - it
  // throws uncaught and crashes the whole homepage, not just the slider.
  const slides = allSlides.filter((s) => isAllowedImageUrl(s.imageUrl));
  const count = slides.length;

  const [index, setIndex] = useState(0);
  const [autoplayAllowed, setAutoplayAllowed] = useState(false);
  const [userStopped, setUserStopped] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const pointerStartX = useRef<number | null>(null);
  const justSwiped = useRef(false);
  // Only the current slide and its neighbours are fetched, so the next
  // banner is ready before it fades in without downloading every banner up front.
  const [warm, setWarm] = useState<Set<number>>(() => new Set([0, 1, count - 1]));

  const [failed, setFailed] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    const wanted = [index, (index + 1) % count, (index - 1 + count) % count];
    setWarm((prev) => (wanted.every((i) => prev.has(i)) ? prev : new Set([...prev, ...wanted])));
  }, [index, count]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 801px) and (hover: hover)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setAutoplayAllowed(desktop.matches && !reduced.matches);
    update();
    desktop.addEventListener('change', update);
    reduced.addEventListener('change', update);
    const onVisibility = () => setPageHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      desktop.removeEventListener('change', update);
      reduced.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const playing = count > 1 && autoplayAllowed && !userStopped;
  const paused = !playing || hovered || pageHidden;

  const goTo = useCallback((next: number) => setIndex(((next % count) + count) % count), [count]);

  // Any deliberate interaction stops autoplay for good, so the slide a
  // shopper chose never moves out from under them.
  function navigate(next: number) {
    setUserStopped(true);
    goTo(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') navigate(index - 1);
    if (event.key === 'ArrowRight') navigate(index + 1);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    pointerStartX.current = event.clientX;
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (pointerStartX.current === null) return;
    const delta = event.clientX - pointerStartX.current;
    pointerStartX.current = null;
    if (Math.abs(delta) > SWIPE_THRESHOLD_PX) {
      justSwiped.current = true;
      navigate(index + (delta < 0 ? 1 : -1));
    }
  }

  if (count === 0) return null;

  return (
    <section
      className={`hero-carousel${playing ? ' is-playing' : ''}${paused ? ' is-paused' : ''}`}
      aria-roledescription="carousel"
      aria-label="Featured collections"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onKeyDown={handleKeyDown}
      style={{ ['--hero-interval' as string]: `${AUTOPLAY_INTERVAL_MS}ms` }}
    >
      <div
        className="hero-carousel__stage"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => (pointerStartX.current = null)}
        onClickCapture={(event) => {
          if (justSwiped.current) {
            justSwiped.current = false;
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {slides.map((slide, i) => {
          const isActive = i === index;
          const href = resolveHref(slide, categories);
          return (
            <div
              key={slide.id}
              className={`hero-carousel__slide${isActive ? ' is-active' : ''}`}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}${slide.title ? `: ${slide.title}` : ''}`}
              aria-hidden={!isActive}
            >
              <Link href={href} className="hero-carousel__link" tabIndex={isActive ? 0 : -1} draggable={false}>
                {warm.has(i) && (
                  <Image
                    src={slide.imageUrl}
                    alt={slide.title ?? 'Featured collection'}
                    fill
                    sizes="(max-width: 1200px) 100vw, 1200px"
                    priority={i === 0}
                    loading={i === 0 ? undefined : 'eager'}
                    unoptimized={failed.has(i)}
                    onError={() => setFailed((prev) => (prev.has(i) ? prev : new Set([...prev, i])))}
                    className="hero-carousel__image"
                    draggable={false}
                  />
                )}
                {slide.title && (
                  <span className="hero-carousel__chip" key={isActive ? `on-${i}` : `off-${i}`}>
                    <span className="hero-carousel__chip-eyebrow">Featured collection</span>
                    <span className="hero-carousel__chip-title">{slide.title}</span>
                    {slide.subtitle && <span className="hero-carousel__chip-sub">{slide.subtitle}</span>}
                    <span className="hero-carousel__chip-cta">
                      Shop now <span aria-hidden="true">→</span>
                    </span>
                  </span>
                )}
              </Link>
            </div>
          );
        })}

        {count > 1 && (
          <>
            <button
              type="button"
              className="hero-carousel__arrow hero-carousel__arrow--prev"
              aria-label="Previous slide"
              onClick={() => navigate(index - 1)}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path
                  d="m15 5-7 7 7 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className="hero-carousel__arrow hero-carousel__arrow--next"
              aria-label="Next slide"
              onClick={() => navigate(index + 1)}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path
                  d="m9 5 7 7-7 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div className="hero-carousel__meta">
              <span className="hero-carousel__counter" aria-live="polite">
                <strong>{String(index + 1).padStart(2, '0')}</strong> / {String(count).padStart(2, '0')}
              </span>
              {autoplayAllowed && (
                <button
                  type="button"
                  className="hero-carousel__toggle"
                  aria-label={userStopped ? 'Play slideshow' : 'Pause slideshow'}
                  onClick={() => setUserStopped((stopped) => !stopped)}
                >
                  {userStopped ? (
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                      <path d="M8 5v14l11-7L8 5Z" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                      <path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" fill="currentColor" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="hero-carousel__tabs" role="tablist" aria-label="Choose a slide">
          {slides.map((slide, i) => {
            const isActive = i === index;
            return (
              <button
                key={slide.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`Show slide ${i + 1}${slide.title ? `: ${slide.title}` : ''}`}
                className={`hero-carousel__tab${isActive ? ' is-active' : ''}`}
                onClick={() => navigate(i)}
              >
                <span className="hero-carousel__tab-label">{slide.title ?? `Slide ${i + 1}`}</span>
                <span className="hero-carousel__tab-track" aria-hidden="true">
                  {isActive && (
                    <span
                      key={`${index}-${playing}`}
                      className="hero-carousel__tab-fill"
                      onAnimationEnd={() => {
                        if (playing) goTo(index + 1);
                      }}
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
