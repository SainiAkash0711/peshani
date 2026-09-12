/** Normalizes arbitrary text into a lowercase, URL-safe, hyphenated slug. */
export function slugify(text: string): string {
  return text
    .toString()
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

/**
 * Generates a slug guaranteed unique within a store by appending -2, -3, ...
 * until `slugExists` reports no collision. `excludeId` lets an update check
 * ignore the record's own current slug.
 */
export async function generateUniqueSlug(
  base: string,
  slugExists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const normalized = slugify(base);
  const root = normalized.length > 0 ? normalized : 'item';

  let candidate = root;
  let suffix = 2;
  while (await slugExists(candidate)) {
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}
