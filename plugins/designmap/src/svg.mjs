/**
 * SVG export of one scene in its CURRENT state: the scene already has layout plus the
 * overlay merge applied, and `colours` carries the overlay colours the merge accepted.
 * The renderer panel is not involved — M4's export must work without a browser.
 *
 * Determinism: pure function of the scene bytes and the colour map, no timestamps, no
 * ids generated at export time. The output is one standalone `<svg>` document.
 */
import { paletteFor } from './palette.mjs'

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function num(value) {
  // The scene is already rounded; keep the SVG free of float noise and NaN.
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0'
}

function textLines(label, x, y, lineHeight = 16) {
  const lines = String(label ?? '').split('\n')
  const start = y - ((lines.length - 1) * lineHeight) / 2
  return lines.map((line, index) => (
    `<tspan x="${x}" y="${num(start + index * lineHeight)}">${escapeXml(line)}</tspan>`
  )).join('')
}

/**
 * Render a scene to SVG.
 * @param scene - scene JSON produced by renderView.
 * @param root0.colours - Map nodeId -> `{fill?, stroke?}` accepted by the overlay merge.
 * @returns the SVG document as a string.
 */
export function sceneToSvg(scene, { colours = new Map() } = {}) {
  const { canvas } = scene
  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${num(canvas.width)}" height="${num(canvas.height)}" viewBox="${num(canvas.x)} ${num(canvas.y)} ${num(canvas.width)} ${num(canvas.height)}" role="img" aria-label="${escapeXml(scene.title || scene.viewId)}">`)
  parts.push('<defs><marker id="designmap-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#475569"/></marker></defs>')
  parts.push(`<rect class="canvas" x="${num(canvas.x)}" y="${num(canvas.y)}" width="${num(canvas.width)}" height="${num(canvas.height)}" fill="#ffffff"/>`)

  if (scene.title !== '') {
    parts.push(`<text class="title" x="${num(canvas.x + 12)}" y="${num(canvas.y + 24)}" font-family="Inter, system-ui, sans-serif" font-size="16" font-weight="600" fill="#0f172a">${escapeXml(scene.title)}</text>`)
  }

  for (const group of scene.groups) {
    parts.push(`<g class="group" data-group-id="${escapeXml(group.id)}">`)
    parts.push(`<rect x="${num(group.x)}" y="${num(group.y)}" width="${num(group.w)}" height="${num(group.h)}" rx="8" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>`)
    if (group.label !== '') {
      parts.push(`<text x="${num(group.x + 10)}" y="${num(group.y + 20)}" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="600" fill="#475569">${escapeXml(group.label)}</text>`)
    }
    parts.push('</g>')
  }

  for (const edge of scene.edges) {
    if (edge.points.length < 2) continue
    const points = edge.points.map(point => `${num(point.x)},${num(point.y)}`).join(' ')
    parts.push(`<g class="edge" data-edge-id="${escapeXml(edge.id)}" data-kind="${escapeXml(edge.kind)}">`)
    parts.push(`<polyline points="${points}" fill="none" stroke="#475569" stroke-width="1.6" marker-end="url(#designmap-arrow)"/>`)
    if (edge.label !== '') {
      parts.push(`<text x="${num(edge.labelAt.x)}" y="${num(edge.labelAt.y)}" font-family="Inter, system-ui, sans-serif" font-size="12" fill="#334155">${escapeXml(edge.label)}</text>`)
    }
    parts.push('</g>')
  }

  for (const node of scene.nodes) {
    const palette = paletteFor(node.type)
    const overlay = colours.get(node.id) ?? {}
    const fill = overlay.fill ?? palette.fill
    const stroke = overlay.stroke ?? palette.stroke
    const centreX = node.x + node.w / 2
    const centreY = node.y + node.h / 2
    parts.push(`<g class="node" data-node-id="${escapeXml(node.id)}" data-type="${escapeXml(node.type)}">`)
    parts.push(`<rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.w)}" height="${num(node.h)}" rx="6" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="1.5"/>`)
    parts.push(`<text x="${num(centreX)}" y="${num(centreY)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="13" fill="#0f172a">${textLines(node.label, centreX, centreY)}</text>`)
    parts.push('</g>')
  }

  parts.push('</svg>')
  return `${parts.join('\n')}\n`
}
