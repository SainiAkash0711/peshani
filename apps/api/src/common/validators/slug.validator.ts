import { Matches } from 'class-validator';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Validates an explicitly-supplied slug: lowercase alphanumerics and single hyphens only. */
export function IsSlug() {
  return Matches(SLUG_PATTERN, {
    message: 'slug must be lowercase, alphanumeric and hyphen-separated (e.g. "mens-clothing")',
  });
}
