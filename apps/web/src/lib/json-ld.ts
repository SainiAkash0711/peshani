/**
 * `JSON.stringify(value)` is safe as JSON but NOT safe to embed verbatim
 * inside `<script>...</script>` - if any string field contains a literal
 * `</script>` sequence (e.g. an admin-controlled product name or a store
 * description), the browser's HTML parser closes the script tag early,
 * turning the remainder of the JSON into raw, executable page markup. The
 * same risk applies to the U+2028/U+2029 line/paragraph separators, which
 * are valid inside a JSON string but invalid inside a JS string literal in
 * some older engines.
 *
 * This does not change the structured-data semantics at all (the escaped
 * sequences are byte-for-byte equivalent JSON to a parser) - it only
 * prevents the browser's HTML tokenizer from ever seeing a real `</script>`,
 * `<!--`, or `<script` substring in the serialized output. Built from
 * character codes (rather than regex literals containing the raw
 * characters) so there is no ambiguity about which bytes are being matched.
 */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

export function safeJsonLd(value: unknown): string {
  let json = JSON.stringify(value);
  json = json.split('<').join('\\u003c');
  json = json.split('>').join('\\u003e');
  json = json.split('&').join('\\u0026');
  json = json.split(LINE_SEPARATOR).join('\\u2028');
  json = json.split(PARAGRAPH_SEPARATOR).join('\\u2029');
  return json;
}
