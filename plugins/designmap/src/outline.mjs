/**
 * The compact read: what a page contains, in text, plus the hints that replace v1's refusals.
 *
 * WHY TEXT BY DEFAULT. A caller that wants the drawing pays for a JSON scene it cannot read;
 * a caller that wants to place one box needs the ids and the two ends of every arrow. The
 * outline is that second reader: one line per shape and one per arrow, and no coordinate
 * unless `format: 'json'` was asked for.
 *
 * HINTS NEVER REFUSE. v1 refused a scene whose labels collided; v2 draws the collision and
 * names it. Every hint is a fact about the drawing, so a page that is ugly is still a page.
 */
import { SHAPES } from './pages.mjs'
import { labelOf } from './elements.mjs'

const SHAPE_NAMES = { rectangle: 'box', ellipse: 'ellipse', diamond: 'diamond' }

/** Shapes that are not deleted, in scene order. */
export function shapesOf(elements) {
  return elements.filter((entry) => entry?.isDeleted !== true && SHAPES.has(entry?.type))
}

/** Arrows that are not deleted, in scene order. */
export function arrowsOf(elements) {
  return elements.filter((entry) => entry?.isDeleted !== true && entry?.type === 'arrow')
}

/** The outline lines: `- [box] Label` and `- A -> B: label`. */
export function outlineLines(scene, page) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : []
  const shapes = shapesOf(elements)
  const arrows = arrowsOf(elements)
  const byId = new Map(shapes.map((shape) => [shape.id, labelOf(elements, shape.id) || shape.id]))
  const lines = [`page: ${page} — ${shapes.length} node(s), ${arrows.length} edge(s)`]
  for (const shape of shapes) {
    const label = labelOf(elements, shape.id)
    lines.push(`- [${SHAPE_NAMES[shape.type] ?? shape.type}] ${label === '' ? `(no label) ${shape.id}` : label}  ${shape.id}`)
  }
  for (const arrow of arrows) {
    const from = byId.get(arrow.startBinding?.elementId) ?? arrow.startBinding?.elementId ?? '?'
    const to = byId.get(arrow.endBinding?.elementId) ?? arrow.endBinding?.elementId ?? '?'
    const label = labelOf(elements, arrow.id)
    lines.push(`- ${from} -> ${to}${label === '' ? '' : `: ${label}`}  ${arrow.id}`)
  }
  return lines
}

function overlaps(a, b) {
  const left = Math.max(a.x, b.x)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const top = Math.max(a.y, b.y)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return right - left > 0 && bottom - top > 0
}

/**
 * The three hints: `node_overlap`, `off_canvas`, `edge_without_label`.
 *
 * Each entry names the elements involved so a caller can move them; none of them is an error.
 */
export function hintsOf(scene) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : []
  const shapes = shapesOf(elements)
  const hints = []
  for (let left = 0; left < shapes.length; left += 1) {
    for (let right = left + 1; right < shapes.length; right += 1) {
      const first = shapes[left]
      const second = shapes[right]
      if (![first.x, first.y, first.width, first.height, second.x, second.y, second.width, second.height].every(Number.isFinite)) continue
      if (overlaps(first, second)) {
        hints.push({ kind: 'node_overlap', elements: [first.id, second.id], message: `${first.id} overlaps ${second.id}` })
      }
    }
  }
  for (const entry of elements) {
    if (entry?.isDeleted === true) continue
    if (![entry?.x, entry?.y].every(Number.isFinite) || entry.x < 0 || entry.y < 0) {
      hints.push({ kind: 'off_canvas', elements: [entry?.id], message: `${entry?.id} starts outside the canvas` })
    }
  }
  for (const arrow of arrowsOf(elements)) {
    if (labelOf(elements, arrow.id) === '') {
      hints.push({ kind: 'edge_without_label', elements: [arrow.id], message: `${arrow.id} has no label` })
    }
  }
  return hints
}

/** The whole read: the text, the counts and the hints. Never refuses. */
export function readOutline(scene, page) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : []
  return {
    ok: true,
    page,
    format: 'outline',
    nodes: shapesOf(elements).length,
    edges: arrowsOf(elements).length,
    outline: outlineLines(scene, page).join('\n'),
    hints: hintsOf(scene),
  }
}
