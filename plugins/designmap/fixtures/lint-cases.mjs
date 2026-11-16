/**
 * Seeded lint fixtures: one case per rule in the lint table, each with the severity the
 * owner spec §8 states. The test drives the real pipeline (renderView / lintScene) and
 * asserts the exact rule + severity that comes out — not a hand-built finding.
 *
 * Severities are authoritative from §8; the rule names come from FR-6.
 */
const view = (id = 'v.lint') => ({ schemaVersion: 1, views: [{ id, title: 'Lint case', level: 'context', direction: 'LR', include: [], parent: null }] })

const node = (id, label = id, extra = {}) => ({ id, type: 'service', label, group: null, source: null, ...extra })
const edge = (id, from, to, label = 'calls', extra = {}) => ({ id, from, to, kind: 'sync', label, ...extra })

function model({ nodes = [], edges = [], groups = [] }) {
  return { schemaVersion: 1, groups, nodes, edges }
}

const LONG_LABEL = 'Checkout API accepts orders and reserves stock before payment'

export const lintCases = [
  {
    name: 'duplicate node id is an error and render refuses',
    rule: 'duplicate_id',
    severity: 'error',
    expectsRefusal: true,
    model: model({ nodes: [node('svc.a'), node('svc.a', 'Second copy')] }),
    views: view(),
  },
  {
    name: 'edge to an unknown node is a dangling error and render refuses',
    rule: 'dangling_edge',
    severity: 'error',
    expectsRefusal: true,
    model: model({ nodes: [node('svc.a')], edges: [edge('e.a.ghost', 'svc.a', 'ghost.node')] }),
    views: view(),
  },
  {
    name: 'node in an unknown group is a dangling-group error and render refuses',
    rule: 'dangling_group',
    severity: 'error',
    expectsRefusal: true,
    model: model({ nodes: [node('svc.a', 'A', { group: 'grp.ghost' })] }),
    views: view(),
  },
  {
    name: 'empty edge label is an error and render refuses',
    rule: 'edge_label_missing',
    severity: 'error',
    expectsRefusal: true,
    model: model({ nodes: [node('svc.a'), node('db.b')], edges: [edge('e.a.b', 'svc.a', 'db.b', '')] }),
    views: view(),
  },
  {
    name: 'label over 40 characters renders with a warning',
    rule: 'label_too_long',
    severity: 'warning',
    model: model({ nodes: [node('svc.a', LONG_LABEL), node('db.b', 'B')], edges: [edge('e.a.b', 'svc.a', 'db.b')] }),
    views: view(),
  },
  {
    name: 'node without an edge is an orphan error and render refuses',
    rule: 'orphan_node',
    severity: 'error',
    expectsRefusal: true,
    model: model({ nodes: [node('svc.a'), node('svc.b')] }),
    views: view(),
  },
  {
    name: 'overlapping boxes after the merge render with a warning',
    rule: 'node_overlap',
    severity: 'warning',
    model: model({ nodes: [node('svc.a'), node('db.b')], edges: [edge('e.a.b', 'svc.a', 'db.b')] }),
    views: view(),
    overlays: {
      $version: 1,
      'svc.a': { x: 100, y: 100 },
      'db.b': { x: 120, y: 110 },
    },
  },
  {
    name: 'a manifest-marked stale node is a warning finding',
    rule: 'stale_node',
    severity: 'warning',
    model: model({ nodes: [node('svc.a'), node('db.b')], edges: [edge('e.a.b', 'svc.a', 'db.b')] }),
    views: view(),
    staleNodeIds: ['svc.a'],
  },
  {
    name: 'overlay colour outside the palette is an info finding',
    rule: 'colour_out_of_palette',
    severity: 'info',
    model: model({ nodes: [node('svc.a'), node('db.b')], edges: [edge('e.a.b', 'svc.a', 'db.b')] }),
    views: view(),
    overlays: { $version: 1, 'svc.a': { fill: '#ff0000' } },
  },
  {
    name: 'a 26-node view is a too-large error and render refuses',
    rule: 'view_too_large',
    severity: 'error',
    expectsRefusal: true,
    model: model({
      nodes: Array.from({ length: 26 }, (_, index) => node(`svc.n${String(index).padStart(2, '0')}`, `N${index}`)),
      edges: Array.from({ length: 25 }, (_, index) => edge(
        `e.n${String(index).padStart(2, '0')}`,
        `svc.n${String(index).padStart(2, '0')}`,
        `svc.n${String(index + 1).padStart(2, '0')}`,
      )),
    }),
    views: view(),
  },
  {
    name: 'a 16-node view is a large warning finding',
    rule: 'view_large',
    severity: 'warning',
    model: model({
      nodes: Array.from({ length: 16 }, (_, index) => node(`svc.n${String(index).padStart(2, '0')}`, `N${index}`)),
      edges: Array.from({ length: 15 }, (_, index) => edge(
        `e.n${String(index).padStart(2, '0')}`,
        `svc.n${String(index).padStart(2, '0')}`,
        `svc.n${String(index + 1).padStart(2, '0')}`,
      )),
    }),
    views: view(),
  },
]

/**
 * Defensive scene rules: the placements these catch can only reach a scene when a human
 * overlay (or a foreign producer) put geometry where the layout would never put it, so
 * they are driven through `lintScene` on a crafted scene rather than through `renderView`.
 */
const defensiveScene = (edges) => ({
  schemaVersion: 1,
  viewId: 'v.defensive',
  title: 'Defensive',
  level: 'context',
  direction: 'LR',
  canvas: { x: 0, y: 0, width: 400, height: 200 },
  nodes: [
    { id: 'svc.a', type: 'service', label: 'A', group: null, x: 20, y: 40, w: 140, h: 44, stale: false, source: null },
    { id: 'svc.b', type: 'service', label: 'B', group: null, x: 240, y: 40, w: 140, h: 44, stale: false, source: null },
  ],
  groups: [],
  edges,
})

const plateOverNode = { x: 60, y: 50, w: 80, h: 25 }
const sharedPlate = { x: 100, y: 55, w: 80, h: 25 }

export const sceneLintCases = [
  {
    name: 'a plate over a node is a warning (a human overlay can create it)',
    rule: 'label_over_node',
    severity: 'warning',
    scene: defensiveScene([
      { id: 'e.a.b', from: 'svc.a', to: 'svc.b', kind: 'sync', label: 'calls', points: [{ x: 160, y: 62 }, { x: 240, y: 62 }], labelBox: plateOverNode, labelAt: { x: plateOverNode.x, y: plateOverNode.y } },
    ]),
  },
  {
    name: 'an edge body through a node is a warning',
    rule: 'edge_through_node',
    severity: 'warning',
    scene: defensiveScene([
      { id: 'e.a.b', from: 'svc.a', to: 'svc.b', kind: 'sync', label: 'calls', points: [{ x: 160, y: 62 }, { x: 300, y: 62 }], labelBox: { x: 20, y: 10, w: 80, h: 25 }, labelAt: { x: 20, y: 10 } },
    ]),
  },
  {
    name: 'two plates sharing most of a rectangle are a warning',
    rule: 'label_label_overlap',
    severity: 'warning',
    scene: defensiveScene([
      { id: 'e.a.b', from: 'svc.a', to: 'svc.b', kind: 'sync', label: 'calls', points: [{ x: 160, y: 62 }, { x: 240, y: 62 }], labelBox: plateOverNode, labelAt: { x: plateOverNode.x, y: plateOverNode.y } },
      { id: 'e.b.a', from: 'svc.b', to: 'svc.a', kind: 'sync', label: 'answers', points: [{ x: 240, y: 70 }, { x: 160, y: 70 }], labelBox: sharedPlate, labelAt: { x: sharedPlate.x, y: sharedPlate.y } },
    ]),
  },
]

/** A crafted scene for the defensive non-finite rule (layout refuses before this point). */
export const nonFiniteScene = {
  schemaVersion: 1,
  viewId: 'v.lint',
  title: 'NaN',
  level: 'context',
  direction: 'LR',
  canvas: { x: 0, y: 0, width: 100, height: 100 },
  nodes: [{ id: 'svc.a', type: 'service', label: 'A', group: null, x: Number.NaN, y: 0, w: 140, h: 44, stale: false, source: null }],
  groups: [],
  edges: [],
}

/** Overlay rows with every tolerated bad value, for the FR-4 merge case. */
export const badOverlays = {
  $version: 1,
  'ghost.node': { x: 10, y: 10 },
  'svc.a': { x: -40, y: 10 },
  'db.b': { x: Number.NaN, y: 20 },
  'queue.c': { fill: '#123456', stroke: '#abcdef' },
  'ext.d': { x: 30, y: 30, wobble: 1 },
}
