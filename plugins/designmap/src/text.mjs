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

/**
 * Width multiplier per shape. A rectangle uses its full width for text; an ellipse and a
 * diamond only use the inscribed part of the box, so their boxes grow until that inscribed
 * area fits the label. Without this the text of a `datastore` (ellipse) or `decision`
 * (diamond) overran the outline - visible on the rendered map as letters crossing the edge.
 */
const SHAPE_WIDTH_FACTOR = { datastore: 1.45, decision: 1.9 }

/* ------------------------------------------------------------------ */
/* Edge labels: the chip the scene draws, sized here and nowhere else. */
/* ------------------------------------------------------------------ */

/**
 * Edge-label typography. The scene carries the resulting `labelBox`; the renderer draws
 * a plate of exactly that size with a bound text inside, so it must never re-measure.
 * The advance estimate is deliberately conservative (0.62 em, wider than Helvetica's
 * average) and the plate carries padding, which keeps the drawn glyphs inside the box
 * even when Excalidraw's own metrics differ by a few percent.
 */
export const EDGE_LABEL_FONT_SIZE = 11
export const EDGE_LABEL_LINE_HEIGHT = 15
export const EDGE_LABEL_PAD_X = 9
export const EDGE_LABEL_PAD_Y = 5
export const EDGE_LABEL_MAX_TEXT_WIDTH = 90
const EDGE_LABEL_ADVANCE_EM = 0.62

/** Estimated text width for a run of text at one font size. */
export function textWidth(text, fontSize) {
  return String(text ?? '').length * fontSize * EDGE_LABEL_ADVANCE_EM
}

/**
 * Wrap an edge label to at most three plate-sized lines. A two-word label that fits on
 * one line stays on one line; a long one loses the third line rather than growing the
 * corridor of the view without bound.
 */
export function wrapEdgeLabel(label) {
  const text = String(label ?? '').trim()
  if (text === '') return ['']
  if (textWidth(text, EDGE_LABEL_FONT_SIZE) <= EDGE_LABEL_MAX_TEXT_WIDTH) return [text]
  const perLine = Math.max(1, Math.floor(EDGE_LABEL_MAX_TEXT_WIDTH / (EDGE_LABEL_FONT_SIZE * EDGE_LABEL_ADVANCE_EM)))
  const words = text.split(/\s+/u)
  const lines = []
  let current = ''
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`
    if (current !== '' && candidate.length > perLine) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
    while (current.length > perLine) {
      lines.push(current.slice(0, perLine))
      current = current.slice(perLine)
    }
  }
  if (current !== '') lines.push(current)
  return lines.slice(0, MAX_LINES)
}

/**
 * The scene's edge-label box: one owner, one formula.
 * @returns `{w, h, lines}` in scene units.
 */
export function edgeLabelSize(label) {
  const lines = wrapEdgeLabel(label)
  const widest = lines.reduce((max, line) => Math.max(max, textWidth(line, EDGE_LABEL_FONT_SIZE)), 0)
  return {
    w: Math.max(28, Math.ceil(widest) + EDGE_LABEL_PAD_X * 2),
    h: lines.length * EDGE_LABEL_LINE_HEIGHT + EDGE_LABEL_PAD_Y * 2,
    lines,
  }
}

/** Final box for one node: text-aware width and height, minimum 44. */
export function nodeSize(label, type = 'service') {
  const lines = wrapLabel(label)
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const base = Math.min(280, Math.max(140, 40 + longest * 7.4))
  const factor = SHAPE_WIDTH_FACTOR[type] ?? 1
  const width = Math.min(factor === 1 ? 280 : 400, base * factor)
  const height = Math.max(44, 16 + lines.length * 18)
  return { w: round2(width), h: round2(height), lines }
}
