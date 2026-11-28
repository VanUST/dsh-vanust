/**
 * The compact read: what a page contains, in text, plus the readability verdict.
 *
 * WHY TEXT BY DEFAULT. A caller that wants the drawing pays for a JSON scene it cannot read;
 * a caller that wants to place one box needs the ids, the two ends of every arrow and - the
 * part this reader used to omit - the coordinates of the boxes it is about to move. The outline
 * is that second reader: an outline line per shape and per arrow, a compact geometry table, and
 * the findings the readability check measured.
 *
 * HINTS NEVER REFUSE. v1 refused a scene whose labels collided; v2 draws the collision and
 * names it. Every hint is a fact about the drawing, so a page that is ugly is still a page.
 */
import { SHAPES } from './pages.mjs'
import { labelOf } from './elements.mjs'
import { analyzeScene, findingsOf, isArrow, isFreeText, layoutBounds } from './lint.mjs'

const SHAPE_NAMES = { rectangle: 'box', ellipse: 'ellipse', diamond: 'diamond' }
const MAX_GEOMETRY_ROWS = 120

/** Shapes that are not deleted, in scene order. */
export function shapesOf(elements) {
  return elements.filter((entry) => entry?.isDeleted !== true && SHAPES.has(entry?.type))
}

/** Arrows that are not deleted, in scene order. */
export function arrowsOf(elements) {
  return elements.filter((entry) => entry?.isDeleted !== true && entry?.type === 'arrow')
}

/** The outline lines: `- [box] Label  id`, arrows, a geometry table and the findings. */
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
  const freeText = elements.filter((entry) => isFreeText(entry))
  for (const note of freeText) {
    const value = String(note.text ?? '').replace(/\n/g, ' / ')
    lines.push(`- [note] ${value}  ${note.id}`)
  }
  if (shapes.length > 0) {
    lines.push('', 'geometry (id x,y w x h):')
    for (const shape of shapes.slice(0, MAX_GEOMETRY_ROWS)) {
      lines.push(`- ${shape.id} ${Math.round(shape.x)},${Math.round(shape.y)} ${Math.round(shape.width)}x${Math.round(shape.height)}`)
    }
    if (shapes.length > MAX_GEOMETRY_ROWS) lines.push(`- … ${shapes.length - MAX_GEOMETRY_ROWS} more node(s)`)
    const bounds = layoutBounds(elements)
    lines.push(`page bounds: ${bounds.width}x${bounds.height} at ${bounds.x},${bounds.y}`)
  }
  const analysis = analyzeScene(scene)
  // An empty page is one line: nothing was drawn, so there is no geometry and no verdict to add.
  if (elements.length === 0) return lines
  if (analysis.findings.length > 0) {
    lines.push('', `readability: ${analysis.score}/100 ${analysis.verdict} — ${analysis.findings.length} finding(s), see map_lint for repairs:`)
    for (const entry of analysis.findings.slice(0, 8)) {
      lines.push(`- [${entry.severity}] ${entry.code}${entry.elements.length === 0 ? '' : ` ${entry.elements.join(', ')}`}: ${entry.message}`)
    }
    if (analysis.findings.length > 8) lines.push(`- … ${analysis.findings.length - 8} more; call map_lint`)
  } else {
    lines.push('', `readability: ${analysis.score}/100 ${analysis.verdict}`)
  }
  return lines
}

/** The hints the tools return: the same facts as findings, in the older shape. */
export function hintsOf(scene) {
  return findingsOf(Array.isArray(scene?.elements) ? scene.elements : []).map((entry) => ({
    kind: entry.code,
    severity: entry.severity,
    elements: entry.elements,
    message: entry.message,
    repair: entry.repair,
  }))
}

/** The geometry table as objects: what a caller needs to move a box, without the raw scene. */
export function geometryOf(elements, limit = MAX_GEOMETRY_ROWS) {
  return shapesOf(elements).slice(0, limit).map((shape) => {
    const label = labelOf(elements, shape.id)
    return {
      id: shape.id,
      kind: shape.type,
      x: Math.round(shape.x),
      y: Math.round(shape.y),
      width: Math.round(shape.width),
      height: Math.round(shape.height),
      ...(label === '' ? {} : { label }),
    }
  })
}

/** The whole read: the text, the counts, the geometry and the readability verdict. Never refuses. */
export function readOutline(scene, page) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : []
  const analysis = analyzeScene(scene)
  return {
    ok: true,
    page,
    format: 'outline',
    nodes: shapesOf(elements).length,
    edges: elements.filter(isArrow).length,
    outline: outlineLines(scene, page).join('\n'),
    geometry: geometryOf(elements),
    readability: { score: analysis.score, verdict: analysis.verdict, counts: analysis.counts },
    hints: hintsOf(scene),
  }
}

/** The full readability report, with every measured finding and its repair. */
export function lintOutline(scene, page) {
  const analysis = analyzeScene(scene)
  return {
    ok: true,
    page,
    score: analysis.score,
    verdict: analysis.verdict,
    counts: analysis.counts,
    bounds: analysis.bounds,
    nodes: analysis.nodes,
    edges: analysis.edges,
    findings: analysis.findings,
  }
}
