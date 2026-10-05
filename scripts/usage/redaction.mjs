/**
 * PURPOSE
 *   Keep identity material out of a usage report, and make that a COMMAND rather
 *   than a claim. A platform usage export carries the account id, a partially
 *   masked API key and the key names in use; a cost report needs none of them, and
 *   a public repository must not carry them. Two things are therefore enforced
 *   here: the columns that hold identity material are named so the reader can drop
 *   them at the parse boundary, and the FINISHED report is scanned for shapes that
 *   could only have come from them, so "the report is redacted" fails a command
 *   instead of resting on the code having done the right thing.
 *
 *   Key NAMES are a special case: which keys exist is identity material, how many
 *   there are is not, and attributing spend to a use case is a legitimate analysis.
 *   {@link labelFactory} is the compromise — each distinct key name maps to a
 *   stable opaque label (`use-case-1`, `use-case-2`, …) that the report may group
 *   by, while the name itself stays in memory and never reaches the page.
 *
 * INPUTS
 *   `IDENTITY_COLUMNS` — header names (matched case-insensitively) the export
 *   reader drops.
 *   `findLeaks(text)` — one rendered report as a string.
 *   `labelFactory()` — no arguments; it keeps its own map per call, so the labels
 *   two files of one export assign to the same name agree.
 *
 * OUTPUTS
 *   `findLeaks(text)` → `[{id, why, sample}]`, empty when the text is clean. The
 *   sample is truncated to four characters and a length, so the check does not
 *   republish what it caught.
 *   `labelFactory()` → `{ label(name), entries() }`, where `label` returns the
 *   opaque label for a key name (`null`/empty → `null`) and `entries` returns the
 *   `[name, label]` pairs so a caller can resolve a name the user typed.
 *
 * KEYWORDS
 *   redaction, identity material, api key, account id, usage report, leak check
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A non-string text: coerced with `String()`, so a `null` render is scanned as
 *     `"null"` rather than throwing.
 *   - A name seen twice: the same label, because the map is keyed by the name.
 *   - A name that is `null`, `undefined` or empty: `label()` returns `null`, and
 *     the caller renders it as an unlabelled bucket rather than inventing a label.
 *   - A report with two leaks of one kind: reported once per pattern, because one
 *     occurrence already makes the report unusable.
 */

/**
 * Export columns that carry identity material.
 *
 * Matched case-insensitively against the CSV header, so an export that renames
 * `user_id` to `userId` is still covered.
 */
export const IDENTITY_COLUMNS = [
  'user_id',
  'userid',
  'user id',
  'api_key',
  'api key',
  'apikey',
  'api_key_name',
  'api key name',
  'key_name',
]

/**
 * Shapes that count as leaked identity material in the RENDERED report.
 *
 * The key pattern is deliberately loose: a DeepSeek key is `sk-` followed by a long
 * run, and a masked key keeps the prefix, so `sk-` plus six alphanumerics catches
 * both the masked and the unmasked spelling without knowing the exact format.
 */
export const LEAK_PATTERNS = [
  { id: 'api-key-material', pattern: /sk-[A-Za-z0-9]{6,}/, why: 'an API key or a truncated API key reached the report' },
  { id: 'uuid', pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, why: 'an account or record identifier reached the report' },
  { id: 'authorization-header', pattern: /(bearer|authorization)\s+[A-Za-z0-9._-]{8,}/i, why: 'a credential-shaped header reached the report' },
]

/**
 * Find identity material in rendered text.
 *
 * @param text - The report about to be emitted.
 * @returns The findings, each `{id, why, sample}`, empty when the text is clean.
 */
export function findLeaks(text) {
  const subject = String(text ?? '')
  const findings = []
  for (const { id, pattern, why } of LEAK_PATTERNS) {
    const match = pattern.exec(subject)
    if (match !== null) findings.push({ id, why, sample: `${match[0].slice(0, 4)}… (${match[0].length} chars)` })
  }
  return findings
}

/**
 * Build the opaque-label mapping one export's key names are grouped by.
 *
 * @returns `{ label, entries, size }`. `label(name)` returns `null` for an absent
 *   name and a stable `use-case-N` otherwise; `entries()` returns the pairs;
 *   `size` is how many distinct names were seen.
 */
export function labelFactory() {
  const labels = new Map()
  return {
    label(name) {
      if (typeof name !== 'string' || name.length === 0) return null
      if (!labels.has(name)) labels.set(name, `use-case-${labels.size + 1}`)
      return labels.get(name)
    },
    entries() {
      return [...labels.entries()]
    },
    get size() {
      return labels.size
    },
  }
}
