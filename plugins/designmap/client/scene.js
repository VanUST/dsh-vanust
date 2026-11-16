/**
 * Scene → render model. This is the only module that touches scene geometry, and it
 * neither invents nor recomputes any: x/y/w/h, group boxes, edge points and label
 * anchors are copied out of the scene JSON as-is (SCENE-CONTRACT §"The scene is the
 * whole presentation geometry"). Colours, stroke widths and shapes come from the
 * renderer's type/kind table, which the contract lets the renderer own.
 */

export const PALETTE = Object.freeze({
  frontend: { fill: '#dbeafe', stroke: '#2563eb' },
  service: { fill: '#e0e7ff', stroke: '#4338ca' },
  worker: { fill: '#dcfce7', stroke: '#16a34a' },
  datastore: { fill: '#fef3c7', stroke: '#d97706' },
  queue: { fill: '#fce7f3', stroke: '#db2777' },
  external: { fill: '#f1f5f9', stroke: '#64748b' },
})

export const EDGE_STYLE = Object.freeze({
  sync: { stroke: '#475569', strokeWidth: 1.6, strokeDasharray: undefined, label: 'sync' },
  async: { stroke: '#7c3aed', strokeWidth: 1.6, strokeDasharray: '6 4', label: 'async' },
  data: { stroke: '#0f766e', strokeWidth: 1.8, strokeDasharray: '2 3', label: 'data' },
})

export const NODE_TYPE_LABEL = Object.freeze({
  frontend: 'frontend',
  service: 'service',
  worker: 'worker',
  datastore: 'datastore',
  queue: 'queue',
  external: 'external',
})

export function paletteFor(type) {
  return PALETTE[type] ?? PALETTE.external
}

export function edgeStyleFor(kind) {
  return EDGE_STYLE[kind] ?? EDGE_STYLE.sync
}

/** The renderer refuses a schema it does not know rather than guessing (contract). */
export function assertScene(scene) {
  if (scene === null || typeof scene !== 'object') throw new Error('designmap: scene is not an object')
  if (scene.schemaVersion !== 1) throw new Error(`designmap: unsupported scene schemaVersion ${String(scene.schemaVersion)}`)
  for (const field of ['nodes', 'groups', 'edges']) {
    if (!Array.isArray(scene[field])) throw new Error(`designmap: scene.${field} is not an array`)
  }
  return scene
}

/** Empty scenes are valid (INV-EMPTY): the panel draws its empty state, not an error. */
export function isEmptyScene(scene) {
  return scene.nodes.length === 0 && scene.groups.length === 0
}

/** Accessible name of one node: label, type, and staleness are all meaningful. */
export function nodeAriaLabel(node) {
  const parts = [node.label, node.type]
  if (node.stale === true) parts.push('stale')
  if (typeof node.source === 'string' && node.source !== '') parts.push(`source ${node.source}`)
  else parts.push('no source')
  return parts.join(', ')
}

export function edgeAriaLabel(edge) {
  return `${edge.label || edge.kind} edge, ${edge.from} to ${edge.to}`
}

/** Case-insensitive substring search over label and semantic id; stable scene order. */
export function searchSceneNodes(nodes, query) {
  const needle = String(query ?? '').trim().toLowerCase()
  if (needle === '') return []
  return nodes.filter(
    (node) =>
      String(node.label ?? '').toLowerCase().includes(needle) ||
      String(node.id ?? '').toLowerCase().includes(needle),
  )
}

/** Sort order for the legend: the contract's six node types, then anything unexpected. */
export function legendNodeTypes(scene) {
  const seen = [...new Set(scene.nodes.map((node) => node.type))]
  const known = Object.keys(PALETTE).filter((type) => seen.includes(type))
  const unknown = seen.filter((type) => !(type in PALETTE))
  return [...known, ...unknown]
}

/** Edge kinds present on this view, in the contract's order. */
export function legendEdgeKinds(scene) {
  const seen = [...new Set(scene.edges.map((edge) => edge.kind))]
  const known = ['sync', 'async', 'data'].filter((kind) => seen.includes(kind))
  const unknown = seen.filter((kind) => !(kind in EDGE_STYLE))
  return [...known, ...unknown]
}

export function groupAriaLabel(group) {
  return `Group ${group.label || group.id}, double-click or press Enter to open`
}
