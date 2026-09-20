const DEFAULT_MESSAGE = "Hi! I have a question about a product on your store.";

/**
 * Floating "chat with us" button that opens WhatsApp with a pre-filled
 * message - reads the store's own supportPhone setting rather than a
 * hardcoded number, and renders nothing at all if that setting is empty
 * (never shows a button that would open a broken/unset chat). No new
 * backend - wa.me is just a plain link, no SDK or API key needed.
 */
export function WhatsAppButton({ phone }: { phone?: string }) {
  const digitsOnly = phone?.replace(/[^\d]/g, '') ?? '';
  if (!digitsOnly) return null;

  const href = `https://wa.me/${digitsOnly}?text=${encodeURIComponent(DEFAULT_MESSAGE)}`;

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="whatsapp-fab" aria-label="Chat with us on WhatsApp">
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
        <path
          fill="#ffffff"
          d="M16 3C9.4 3 4 8.4 4 15c0 2.2.6 4.3 1.7 6.1L4 29l8.1-1.6C13.8 28.1 14.9 28.3 16 28.3c6.6 0 12-5.4 12-12S22.6 3 16 3Zm0 21.9c-1 0-2-.2-2.9-.5l-.5-.2-4.8.9.9-4.7-.3-.5A9.9 9.9 0 0 1 6.1 15c0-5.5 4.4-9.9 9.9-9.9s9.9 4.4 9.9 9.9-4.4 9.9-9.9 9.9Zm5.4-7.4c-.3-.1-1.7-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.1-.2.2-.3.2-.6.1-.3-.2-1.2-.5-2.3-1.5-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5 0-.2-.7-1.7-1-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.2 3.4 5.3 4.7.7.3 1.3.5 1.8.7.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3Z"
        />
      </svg>
    </a>
  );
}
