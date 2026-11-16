/**
 * Core-owned text metrics and node sizing.
 *
 * SCENE-CONTRACT, `nodes[].label`: core wraps the label into ONE string with `\n`,
 * never more than 3 lines, truncating the third with `…`; a label longer than 40
 * characters is a lint warning. `w`/`h` follow the contract formulas:
 *   w = clamp(140, 40 + longest line × 7.4, 280)
 *   h = 16 + lines × 18, minimum 44
 * The renderer draws these boxes; it must not re-wrap or resize them.
 */
import { round2 } from './canonical.mjs'

export const MAX_LABEL_CHARS = 40
export const MAX_LINES = 3
const ELLIPSIS = '…'

/**
 * Wrap one label into at most three lines of at most 40 characters.
 * Explicit newlines in the source label are respected first, then each line is
 * word-wrapped; hard-to-break tokens are cut.
 */
export function wrapLabel(label) {
  const source = String(label ?? '')
  const hard = source.split(/\r?\n/u)
  const lines = []
  for (const paragraph of hard) {
    const words = paragraph.split(/\s+/u).filter(word => word.length > 0)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let current = ''
    for (const word of words) {
      const candidate = current === '' ? word : `${current} ${word}`
      if (candidate.length <= MAX_LABEL_CHARS) {
        current = candidate
        continue
      }
      if (current !== '') {
        lines.push(current)
        current = ''
      }
      // A single token longer than the wrap width is cut into chunks.
      let rest = word
      while (rest.length > MAX_LABEL_CHARS) {
        lines.push(rest.slice(0, MAX_LABEL_CHARS))
        rest = rest.slice(MAX_LABEL_CHARS)
      }
      current = rest
    }
    if (current !== '') lines.push(current)
  }
  const capped = lines.length === 0 ? [''] : lines
  if (capped.length <= MAX_LINES) return capped
  const head = capped.slice(0, MAX_LINES - 1)
  const last = capped[MAX_LINES - 1]
  head.push(last.length >= MAX_LABEL_CHARS ? `${last.slice(0, MAX_LABEL_CHARS - 1)}${ELLIPSIS}` : last)
  return head
}

/** The wrapped label as the scene carries it: one string, lines joined with `\n`. */
export function sceneLabel(label) {
  return wrapLabel(label).join('\n')
}

/** Source label length in characters, newlines removed, for the label-length lint. */
export function labelLength(label) {
  return String(label ?? '').replace(/\r?\n/gu, ' ').length
}

/** Final box for one node: text-aware width and height, minimum 44. */
export function nodeSize(label) {
  const lines = wrapLabel(label)
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const width = Math.min(280, Math.max(140, 40 + longest * 7.4))
  const height = Math.max(44, 16 + lines.length * 18)
  return { w: round2(width), h: round2(height), lines }
}
