/**
 * The site's brand mark: a shopping cart (wheels + a smooth pull handle)
 * with a two-tone leaf sprig and a small berry accent growing out of it,
 * set inside a thin circular badge ring for a finished, emblem-like
 * presence. "Cart + leaf" is the standard visual convention for a
 * natural/organic/handmade shop (fresh goods you can shop for).
 *
 * Deliberately restrained: professional logo marks are judged on
 * simplicity, scalability, and working in a single color (a mark that
 * only reads at one size, in full color, on a white background isn't
 * finished) - so this uses flat fills (no gradients) and skips decorative
 * texture/shine details that would just turn to mud at real favicon size
 * (16-32px) or vanish in a monochrome/embossed context. Colors are the
 * site's own existing palette (--color-accent emerald, --color-secondary
 * gold, and their -dark variants) rather than new ones. No image asset -
 * an inline SVG stays crisp at any size/DPI, consistent with every other
 * icon in this header (search, wishlist, cart).
 */
export function Logo({ name }: { name: string }) {
  return (
    <>
      <svg viewBox="0 0 40 40" width="38" height="38" aria-hidden="true" className="site-header__logo-mark">
        {/* badge ring */}
        <circle cx="20" cy="20" r="18.3" fill="none" style={{ stroke: 'var(--color-secondary)' }} strokeWidth="1.3" />

        {/* pull handle - one smooth curve */}
        <path
          d="M10 16 Q5 16 4 9.5"
          fill="none"
          style={{ stroke: 'var(--color-secondary-dark)' }}
          strokeWidth="1.8"
          strokeLinecap="round"
        />

        {/* leaf sprig + berry growing out of the cart */}
        <path d="M20 12 C16 11 13 7.5 14 2.5 C18 3.5 21 7 20 12 Z" style={{ fill: 'var(--color-accent)' }} />
        <path d="M20 12 C24 11 27 7.5 26 2.5 C22 3.5 19 7 20 12 Z" style={{ fill: 'var(--color-accent-dark)' }} />
        <circle cx="20" cy="12.6" r="1.4" style={{ fill: 'var(--color-secondary)' }} />

        {/* cart body - flat fill, no gradient */}
        <path
          d="M10 16 L30 16 L26.5 28 C26.3 28.8 25.6 29.5 24.7 29.5 L15.3 29.5 C14.4 29.5 13.7 28.8 13.5 28 Z"
          style={{ fill: 'var(--color-secondary)' }}
        />
        {/* rim */}
        <rect x="10" y="15" width="20" height="2" rx="1" style={{ fill: 'var(--color-secondary-dark)' }} />

        {/* wheels */}
        <circle cx="16.5" cy="33.5" r="2.3" style={{ fill: 'var(--color-secondary-dark)' }} />
        <circle cx="23.5" cy="33.5" r="2.3" style={{ fill: 'var(--color-secondary-dark)' }} />
      </svg>
      <span className="site-header__brand-text">{name}</span>
    </>
  );
}
