/**
 * §28 - server-generated CSV export. A cell value beginning with
 * `= + - @` (or a tab/CR, which some spreadsheet parsers also treat as a
 * formula prefix) is prefixed with a single quote so it is never
 * interpreted as a formula by Excel/Sheets/LibreOffice when the file is
 * opened - the classic "CSV injection" mitigation. Applied to every string
 * cell; numbers/booleans/null are never at risk and pass through as-is.
 */
const FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r]/;

function sanitizeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  const safe = FORMULA_PREFIX_PATTERN.test(str) ? `'${str}` : str;
  // Standard CSV quoting: wrap in quotes and escape embedded quotes whenever
  // the value contains a comma, quote, or newline.
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.map(sanitizeCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => sanitizeCell(row[h])).join(','));
  }
  return lines.join('\r\n');
}
