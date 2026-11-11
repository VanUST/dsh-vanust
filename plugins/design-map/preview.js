/**
 * PURPOSE
 *   The agent's eye. The tool writes a graph; the plugin lays it out; this module
 *   turns the scene's REAL geometry back into a few lines of text, so the model can
 *   see what the human will see without a browser: which stage each box is in, which
 *   layer band it sits in, what shape it is, and what the arrows say. It also folds
 *   the validator's issues into one line with the next action.
 *
 * INPUTS
 *   {title, rev, nodes, edges, lanes, health, elementCount} - nodes carry x/y/width,
 *   edges carry from/to/label, lanes carry id/label/members. Everything is already
 *   derived from the scene by index.js; nothing here touches the file or Excalidraw.
 *
 * OUTPUTS
 *   A bounded multi-line string (<= 44 lines, cells <= 30 chars). Oversized maps are
 *   truncated EXPLICITLY, never silently.
 */

const CELL_MAX = 30
const LINE_MAX = 110
const MAX_LINES = 44
const MAX_FLOWS = 12

/** `[service] (store) <decision> /external/` - the shape a kind draws. */
export function glyph(kind, label) {
  const text = String(label ?? '')
  const marks = kind === 'store' ? ['(', ')'] : kind === 'decision' ? ['<', '>'] : kind === 'external' ? ['/', '/'] : ['[', ']']
  return `${marks[0]}${text}${marks[1]}`
}

function clip(text, max = CELL_MAX) {
  const flat = String(text ?? '').replace(/\s*\n\s*/g, ' / ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, Math.max(max - 1, 1))}…`
}

/**
 * Column index per node: nodes whose x ranges overlap substantially form one stage.
 *
 * Overlap, not "close enough", is the test. A chained rule (a node joins if its left
 * edge is near the running right edge) collapses a whole map into one column as soon
 * as the first two boxes touch - measured on the map this replaced.
 */
function columnsOf(nodes) {
  const ordered = [...nodes].sort((a, b) => a.x - b.x || a.y - b.y)
  const columns = []
  for (const node of ordered) {
    const column = columns[columns.length - 1]
    const shared = column === undefined ? 0 : Math.max(0, Math.min(column.right, node.x + node.width) - Math.max(column.left, node.x))
    const smallest = column === undefined ? 1 : Math.min(node.width, column.right - column.left)
    if (column !== undefined && shared / Math.max(smallest, 1) >= 0.5) {
      column.nodes.push(node)
      column.left = Math.min(column.left, node.x)
      column.right = Math.max(column.right, node.x + node.width)
    } else {
      columns.push({ left: node.x, right: node.x + node.width, nodes: [node] })
    }
  }
  for (const column of columns) column.nodes.sort((a, b) => a.y - b.y)
  return columns
}

function pad(text, width) {
  return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

/** One line per stage (no lanes) or one table row per layer band (lanes). */
function grid({ nodes, lanes }) {
  const columns = columnsOf(nodes)
  if (nodes.length === 0) return ['  (empty map)']
  if (lanes.length === 0) {
    return columns.map((column, index) => `stage ${index + 1}: ${column.nodes.map((node) => glyph(node.kind, clip(node.label, 26))).join(' · ')}`)
  }
  const rows = lanes.map((lane) => ({ label: clip(lane.label || lane.id, 14), members: new Set(lane.members) }))
  const cells = rows.map((row) => columns.map((column) => column.nodes
    .filter((node) => row.members.has(node.id))
    .map((node) => glyph(node.kind, clip(node.label, 18)))
    .join(' ')))
  const widths = columns.map((_column, index) => Math.min(CELL_MAX, Math.max(0, ...cells.map((row) => row[index].length))))
  const labelWidth = Math.max(...rows.map((row) => row.label.length), 0) + 2
  const headerWidth = columns.map((_column, index) => Math.max(widths[index], `stage ${index + 1}`.length))
  const out = [`${pad('', labelWidth)}${columns.map((_column, index) => pad(`stage ${index + 1}`, headerWidth[index] + 2)).join('').trimEnd()}`]
  rows.forEach((row, index) => {
    out.push(`${pad(row.label, labelWidth)}${cells[index].map((cell, column) => pad(cell, widths[column] + 2)).join('').trimEnd()}`)
  })
  return out
}

function wrapLine(prefix, text) {
  const body = `${prefix}${text}`
  if (body.length <= LINE_MAX) return [body]
  const out = []
  let rest = text
  let head = prefix
  while (rest.length > 0) {
    const room = Math.max(LINE_MAX - head.length, 20)
    if (rest.length <= room) { out.push(head + rest); break }
    const cut = rest.lastIndexOf(' ', room)
    const at = cut > 20 ? cut : room
    out.push(head + rest.slice(0, at))
    rest = rest.slice(at).trimStart()
    head = ' '.repeat(prefix.length)
  }
  return out
}

/** Phrase the validator's findings as one line with the next action. */
export function healthLine(health) {
  if (health === undefined || health === null) return ''
  if (health.ok === true) return 'ok - labels fit, nothing overlaps, arrows stay clear'
  const issues = Array.isArray(health.issues) ? health.issues : []
  const total = Number.isSafeInteger(health.issueCount) ? health.issueCount : issues.length
  const counts = new Map()
  for (const issue of issues) counts.set(issue.kind, (counts.get(issue.kind) ?? 0) + 1)
  const summary = [...counts.entries()].map(([kind, count]) => `${kind} x${count}`).join(', ')
  const first = issues[0]?.detail ?? ''
  const action = health.hint ?? (total > 0 ? 'run layout to repair' : '')
  const more = total > 1 ? ` (+${total - 1} more)` : ''
  return `${total} issue(s): ${summary}. ${first}${more}${action === '' ? '' : ` - ${action}`}`
}

/**
 * Render the map as the human sees it, bounded.
 *
 * @param {{title?:string,rev?:number,nodes:Array,edges:Array,lanes?:Array,health?:object,elementCount?:number}} map
 * @returns {string} the preview text
 */
export function renderPreview({ title, rev, nodes = [], edges = [], lanes = [], health, elementCount } = {}) {
  const name = typeof title === 'string' && title !== '' ? title : 'design map'
  const counts = [`${nodes.length} node${nodes.length === 1 ? '' : 's'}`, `${edges.length} flow${edges.length === 1 ? '' : 's'}`]
  if (lanes.length > 0) counts.push(`${lanes.length} layer${lanes.length === 1 ? '' : 's'}`)
  if (Number.isSafeInteger(elementCount)) counts.push(`${elementCount} elements`)
  const head = `${name} - rev ${Number.isSafeInteger(rev) ? rev : 0}, ${counts.join(', ')}`
  const lines = [head, '']
  const hasLanes = lanes.length > 0 && nodes.some((node) => node.layer !== undefined && node.layer !== null)
  lines.push(...grid({ nodes, lanes: hasLanes ? lanes : [] }))
  if (hasLanes) {
    // A node that names no band still has to appear somewhere.
    const known = new Set(lanes.flatMap((lane) => lane.members))
    const loose = nodes.filter((node) => !known.has(node.id))
    if (loose.length > 0) lines.push(`(no layer) ${loose.map((node) => glyph(node.kind, clip(node.label, 18))).join(' · ')}`)
  }
  const nameById = new Map(nodes.map((node) => [node.id, clip(node.label || node.id, 34)]))
  const flowLines = edges.slice(0, MAX_FLOWS).map((edge) => {
    const label = typeof edge.label === 'string' && edge.label !== '' ? ` "${clip(edge.label, 28)}"` : ''
    return `${nameById.get(edge.from) ?? edge.from} -> ${nameById.get(edge.to) ?? edge.to}${label}`
  })
  if (flowLines.length > 0) {
    if (edges.length > flowLines.length) flowLines.push(`+${edges.length - flowLines.length} more flow(s)`)
    lines.push('', ...wrapLine('flows: ', flowLines.join('; ')))
  }
  const health_ = healthLine(health)
  if (health_ !== '') lines.push(...wrapLine('health: ', health_))
  const kinds = new Set(nodes.map((node) => node.kind ?? 'service'))
  const legend = []
  if (kinds.size > 1 || hasLanes) legend.push('[service] (store) <decision> /external/')
  if (hasLanes) legend.push('a band is a layer, top to bottom; stages are columns left to right')
  if (legend.length > 0) lines.push(...wrapLine('legend: ', legend.join('; ')))
  if (lines.length > MAX_LINES) {
    const kept = lines.slice(0, MAX_LINES - 1)
    kept.push(`… preview truncated at ${MAX_LINES - 1} of ${lines.length} lines (${nodes.length} nodes, ${edges.length} flows)`)
    return kept.join('\n')
  }
  return lines.join('\n')
}
