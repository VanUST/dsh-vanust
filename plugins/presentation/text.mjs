/**
 * PURPOSE: The small text layer every renderer shares — HTML escaping, the two
 *          inline markers a spec may use, number formatting and tone naming — so
 *          the deck and the board cannot drift apart on how a string becomes HTML.
 * INPUTS:  strings, numbers and arrays from a spec.
 * OUTPUTS: escaped HTML strings; `tone()` returns a token name that exists in
 *          theme.css, never a raw colour.
 * KEYWORDS: presentation, deck, dashboard, escape, inline-markup, text.
 */

/** The five tones a component may reference; anything else becomes the accent. */
export const TONES = ['accent', 'ink', 'muted', 'info', 'ok', 'danger', 'violet', 'cyan']

/**
 * Escapes the five HTML-significant characters. Kept separate from `inline` so a
 * value that must stay literal (an SVG attribute, a file name) can use it alone.
 * @param value - Any value; non-strings are stringified first.
 * @returns The text safe to place in HTML content or a double-quoted attribute.
 */
export function esc(value) {
  const text = value === undefined || value === null ? '' : String(value)
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Escapes, then applies the two inline markers the spec allows: `**bold**` and
 * `==highlight==`. Escaping first means a marker cannot smuggle markup in.
 * @param value - Text to convert.
 * @returns HTML-safe text with bold and highlight applied.
 */
export function inline(value) {
  return esc(value)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/==([^=]+)==/g, '<span class="hl">$1</span>')
}

/**
 * Keeps a tone inside the palette: a spec names `ok`/`danger`/…, not `#ff0`.
 * @param value - Requested tone.
 * @param fallback - Tone used when the value is not in the palette.
 * @returns A tone name from TONES.
 */
export function tone(value, fallback = 'accent') {
  return typeof value === 'string' && TONES.includes(value) ? value : fallback
}

/**
 * Turns a spec value into a finite number, or null. Charts refuse to invent a
 * value, so a missing point is dropped rather than drawn at zero.
 * @param value - Candidate number.
 * @returns A finite number, or null.
 */
export function num(value) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Formats a number for a label: integers keep no decimals, fractions keep at most
 * two, and thousands get a thin space so `1 234 567` stays readable on a slide.
 * @param value - The number to show.
 * @param digits - Maximum fraction digits (default 2).
 * @returns The formatted string.
 */
export function fmt(value, digits = 2) {
  const parsed = num(value)
  if (parsed === null) return ''
  const rounded = Number.isInteger(parsed) ? parsed : Number(parsed.toFixed(digits))
  const [whole, fraction] = String(rounded).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009')
  return fraction === undefined ? grouped : `${grouped},${fraction}`
}

/**
 * Picks the number a `[data-count]` element should animate to. The player reads
 * the same attribute, so the renderer and the runtime agree on what to count.
 * @param value - Raw spec value.
 * @returns The numeric target, or null when the value is not a number.
 */
export function countTarget(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = String(value ?? '').replace(/[\s\u2009]/g, '').replace(',', '.')
  const match = /^(-?\d+(?:\.\d+)?)(.*)$/.exec(text)
  return match === null ? null : Number(match[1])
}

/**
 * Splits a value into the number to count and its suffix, so `93,8 %` animates
 * the number and keeps the unit beside it.
 * @param value - Raw spec value.
 * @returns `{ to, suffix }` when the value starts with a number, else null.
 */
export function countParts(value) {
  const text = String(value ?? '').trim()
  const match = /^(-?\d+(?:[.,]\d+)?)([\s\S]*)$/.exec(text)
  if (match === null) return null
  const to = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(to)) return null
  return { to, suffix: match[2] }
}
