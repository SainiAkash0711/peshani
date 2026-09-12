import { Injectable } from '@nestjs/common';

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * §11 - safe, deterministic `{{variableName}}` substitution. No arbitrary
 * JavaScript evaluation of any kind (no eval, no Function constructor, no
 * template-literal construction from user/admin-supplied strings) - a
 * template body is plain data, substitution is a single regex replace pass.
 * A variable missing from the supplied map renders as an empty string
 * rather than throwing, so a template referencing an unexpected/renamed
 * variable degrades gracefully instead of breaking delivery.
 */
@Injectable()
export class TemplateRendererService {
  render(body: string, variables: Record<string, string>): string {
    return body.replace(VARIABLE_PATTERN, (_match, name: string) => variables[name] ?? '');
  }

  /** Same substitution, HTML-escaping each variable value first - used for the EMAIL channel's HTML body so a variable value (e.g. a customer-chosen order note) can never inject markup into the outgoing email. */
  renderHtml(body: string, variables: Record<string, string>): string {
    const escaped: Record<string, string> = {};
    for (const [key, value] of Object.entries(variables)) {
      escaped[key] = escapeHtml(value);
    }
    return this.render(body, escaped);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
