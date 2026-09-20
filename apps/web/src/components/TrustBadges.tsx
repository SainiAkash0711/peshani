const ITEMS = [
  {
    label: 'Secure Payments',
    icon: (
      <path
        d="M12 2 4 5v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5l-8-3Zm-1.2 13.4-3-3 1.4-1.4 1.6 1.6 4.6-4.6 1.4 1.4-6 6Z"
        fill="currentColor"
      />
    ),
  },
  {
    label: 'Easy Returns',
    icon: (
      <path
        d="M6 8h9a5 5 0 0 1 0 10h-3v-2h3a3 3 0 0 0 0-6H6.83l2.58 2.59L8 14 3 9l5-5 1.41 1.41L6.83 8Z"
        fill="currentColor"
      />
    ),
  },
  {
    label: 'Quality Assured',
    icon: (
      <path
        d="m12 2 2.4 4.86 5.37.78-3.89 3.79.92 5.35L12 14.27l-4.8 2.51.92-5.35-3.89-3.79 5.37-.78L12 2Z"
        fill="currentColor"
      />
    ),
  },
  {
    label: '24x7 Support',
    icon: (
      <path
        d="M12 2a8 8 0 0 0-8 8v6a2.5 2.5 0 0 0 2.5 2.5H8v-7H5.05A7 7 0 0 1 19 10v1h-2.95v7H18a4 4 0 0 0 4-4v-4a8 8 0 0 0-8-8Z"
        fill="currentColor"
      />
    ),
  },
];

/**
 * Static marketing strip - deliberately generic, verifiable claims only
 * ("Easy Returns" mirrors the store's real Returns feature; no specific
 * shipping-cost or delivery-time promise is made here since that's set by
 * whatever shipping methods the store owner configures, not something this
 * component can know).
 */
export function TrustBadges() {
  return (
    <div className="trust-badges">
      {ITEMS.map((item) => (
        <div key={item.label} className="trust-badges__item">
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
            {item.icon}
          </svg>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
