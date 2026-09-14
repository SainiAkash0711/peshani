import sanitizeHtml from 'sanitize-html';

/**
 * The one enforcement point for any HTML that ends up stored and later
 * rendered as markup on the storefront (currently: blog post content,
 * authored via the admin's rich text editor). Only a small allowlist of
 * formatting tags/attributes survives - everything else (scripts, iframes,
 * inline event handlers, style attributes, etc.) is stripped, independent of
 * what the client claims to have sent.
 */
export function sanitizeRichTextHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'strong', 'em', 's', 'u', 'a',
      'h2', 'h3', 'h4',
      'ul', 'ol', 'li',
      'blockquote', 'code', 'pre',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    },
  });
}
