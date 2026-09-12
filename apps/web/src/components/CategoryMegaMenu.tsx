'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { CategoryTreeNode } from '../types/catalog';
import { isAllowedImageUrl } from '../lib/safe-image';

const MAX_TOP_CATEGORIES = 9;

export function CategoryMegaMenu({ categories }: { categories: CategoryTreeNode[] }) {
  const topCategories = categories.slice(0, MAX_TOP_CATEGORIES);
  const [openId, setOpenId] = useState<string | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenId(null);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenId(null);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  // The panel renders as position:fixed (see the CSS comment on
  // .mega-nav__panel for why) so its position has to be computed from the
  // trigger's real screen coordinates rather than left to CSS.
  function openNow(id: string) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const el = itemRefs.current[id];
    if (el) {
      const rect = el.getBoundingClientRect();
      // Below 800px the panel spans the full viewport width (see the
      // matching CSS media query), so it always starts at the left edge
      // regardless of where the trigger sits. Above that, clamp so a
      // trigger near the right edge doesn't push the ~640-900px-wide panel
      // off-screen.
      const isNarrow = window.innerWidth <= 800;
      const left = isNarrow ? 0 : Math.max(8, Math.min(rect.left, window.innerWidth - 660));
      setPanelPos({ top: rect.bottom, left });
    }
    setOpenId(id);
  }

  // Small delay so moving the mouse from the trigger down into the panel
  // (a real gap of a few pixels) doesn't flicker the panel closed first.
  function scheduleClose(id: string) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpenId((current) => (current === id ? null : current));
    }, 150);
  }

  if (topCategories.length === 0) return null;

  return (
    <nav className="mega-nav" aria-label="Shop by category" ref={navRef}>
      <div className="container mega-nav__bar">
        {topCategories.map((category) => {
          const hasChildren = category.children.length > 0;
          const isOpen = openId === category.id;
          const icon = (
            <span className="mega-nav__icon">
              {category.image && isAllowedImageUrl(category.image) ? (
                <Image src={category.image} alt="" fill sizes="40px" />
              ) : (
                <span className="mega-nav__icon-fallback">{category.name.charAt(0)}</span>
              )}
            </span>
          );

          return (
            <div
              className={`mega-nav__item${isOpen ? ' is-open' : ''}`}
              key={category.id}
              ref={(el) => {
                itemRefs.current[category.id] = el;
              }}
              onMouseEnter={hasChildren ? () => openNow(category.id) : undefined}
              onMouseLeave={hasChildren ? () => scheduleClose(category.id) : undefined}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="mega-nav__link"
                  aria-expanded={isOpen}
                  onClick={() => (isOpen ? setOpenId(null) : openNow(category.id))}
                >
                  {icon}
                  <span className="mega-nav__label">{category.name}</span>
                  <span className="mega-nav__caret" aria-hidden="true" />
                </button>
              ) : (
                <Link href={`/categories/${category.slug}`} className="mega-nav__link">
                  {icon}
                  <span className="mega-nav__label">{category.name}</span>
                </Link>
              )}

              {hasChildren && (
                <div
                  className="mega-nav__panel"
                  hidden={!isOpen}
                  style={isOpen && panelPos ? { top: panelPos.top, left: panelPos.left } : undefined}
                >
                  <div className="mega-nav__panel-inner">
                    <div className="mega-nav__panel-heading">{category.name}</div>
                    <div className="mega-nav__grid">
                      {category.children.map((sub) => (
                        <Link
                          key={sub.id}
                          href={`/categories/${sub.slug}`}
                          className="mega-nav__sub-link"
                          onClick={() => setOpenId(null)}
                        >
                          {sub.name}
                        </Link>
                      ))}
                    </div>
                    <Link
                      href={`/categories/${category.slug}`}
                      className="mega-nav__view-all"
                      onClick={() => setOpenId(null)}
                    >
                      View all {category.name} →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
