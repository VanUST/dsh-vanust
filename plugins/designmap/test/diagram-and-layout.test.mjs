/*
PROOF: an agent draws a readable scheme in one call, and the layout reserves the label space
Behavior: map_edit op diagram creates every node and edge of a page in ONE call, resolves
  edges by node id or label, lays the page out in the requested direction, and reports the
  created ids; the distance between two layers is at least the widest edge label crossing them
  plus a margin, because Excalidraw draws an arrow label at the arrow's middle (v0.18.1
  textElement.ts getBoundTextMaxWidth); a node added without coordinates takes a free cell in
  the flow, so three adds make a row and not a vertical column; note.add writes a free text;
  align moves the boxes; node.move re-anchors the arrows attached to the moved box; a diagram
  that names an unknown node is refused by name.
Fails when: diagram needs one call per element again, the layer gap goes back to a fixed 96
  and a longer label lands on the boxes, auto-placement puts a coordinate-less node under the
  page, moving a box leaves its arrow behind, or an unknown node becomes a silent no-op.
Production path: plugins/designmap/src/ops.mjs (diagram/layout/note.add/align/node.move) and
  src/tidy.mjs (layoutElements) through map_edit and the /designmap command's tidy-page.
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyOp } from '../src/ops.mjs'
import { readPage } from '../src/pages.mjs'
import { layoutBounds } from '../src/lint.mjs'
import { textWidth } from '../src/elements.mjs'
import { shapesOf } from '../src/outline.mjs'

const scratch = () => mkdtempSync(join(tmpdir(), 'designmap-diagram-'))
const shapesIn = (dir, page) => shapesOf(readPage(dir, page).elements)

test('one diagram call creates every node and edge and lays them out', () => {
  const dir = scratch()
  applyOp(dir, { op: 'page.create', page: 'system' })
  const result = applyOp(dir, {
    op: 'diagram',
    page: 'system',
    direction: 'LR',
    nodes: [
      { label: 'CLI' },
      { label: 'Orchestrator' },
      { label: 'Taskboard' },
      { label: 'Design map', kind: 'ellipse' },
      { label: 'Analysis record', kind: 'diamond', color: 'violet' },
    ],
    edges: [
      { from: 'CLI', to: 'Orchestrator', label: 'asks' },
      { from: 'Orchestrator', to: 'Taskboard', label: 'writes' },
      { from: 'Orchestrator', to: 'Design map', label: 'draws' },
      { from: 'Design map', to: 'Analysis record', label: 'records' },
      { from: 'Taskboard', to: 'Analysis record', label: 'evidence', style: 'dashed' },
    ],
  })
  assert.equal(result.action, 'diagram')
  assert.equal(result.created.nodes.length, 5)
  assert.equal(result.created.edges.length, 5)
  assert.equal(result.nodes, 5)
  assert.equal(result.edges, 5)
  assert.equal(result.readability.verdict, 'clean', JSON.stringify(result.hints))

  const shapes = shapesIn(dir, 'system')
  assert.equal(shapes.length, 5)
  for (const shape of shapes) assert.ok(shape.x >= 0 && shape.y >= 0, `${shape.id} is off the origin`)
  // The five nodes are in four layers: the widest one holds two boxes stacked, and no two
  // boxes overlap anywhere on the page.
  for (let left = 0; left < shapes.length; left += 1) {
    for (let right = left + 1; right < shapes.length; right += 1) {
      const a = shapes[left]
      const b = shapes[right]
      const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      assert.equal(w > 0 && h > 0, false, `${a.id} overlaps ${b.id}`)
    }
  }
  const diamond = shapes.find((shape) => shape.type === 'diamond')
  assert.equal(diamond.backgroundColor, '#d0bfff', 'the named colour did not reach the element')
  const dashed = readPage(dir, 'system').elements.find((entry) => entry.type === 'arrow' && entry.strokeStyle === 'dashed')
  assert.ok(dashed !== undefined, 'the dashed edge lost its style')
})

test('a top-to-bottom diagram stacks the layers vertically', () => {
  const dir = scratch()
  applyOp(dir, { op: 'page.create', page: 'tb' })
  applyOp(dir, {
    op: 'diagram',
    page: 'tb',
    direction: 'TB',
    nodes: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
    edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }],
  })
  const shapes = shapesIn(dir, 'tb')
  const a = shapes.find((shape) => shape.id === 'n1')
  const b = shapes.find((shape) => shape.id === 'n2')
  const c = shapes.find((shape) => shape.id === 'n3')
  assert.ok(b.y > a.y + a.height, 'B is not below A')
  assert.ok(c.y > b.y + b.height, 'C is not below B')
})

test('the layer gap reserves the widest edge label, so a label does not land on a box', () => {
  const dir = scratch()
  applyOp(dir, { op: 'page.create', page: 'gap' })
  applyOp(dir, {
    op: 'diagram',
    page: 'gap',
    nodes: [{ label: 'Client' }, { label: 'Service' }],
    edges: [{ from: 'Client', to: 'Service', label: 'reads the model every turn' }],
  })
  const shapes = shapesIn(dir, 'gap')
  const left = shapes.find((shape) => shape.id === 'n1')
  const right = shapes.find((shape) => shape.id === 'n2')
  const gap = right.x - (left.x + left.width)
  assert.ok(gap >= textWidth('reads the model every turn') + 24, `gap ${gap} does not fit the label`)
  const hints = applyOp(dir, { op: 'layout', page: 'gap' }).hints
  assert.equal(hints.some((hint) => hint.kind === 'edge_label_on_node'), false)
})

test('three coordinate-less nodes make a row, not a vertical column', () => {
  const dir = scratch()
  applyOp(dir, { op: 'page.create', page: 'auto' })
  applyOp(dir, { op: 'node.add', page: 'auto', label: 'One' })
  applyOp(dir, { op: 'node.add', page: 'auto', label: 'Two' })
  applyOp(dir, { op: 'node.add', page: 'auto', label: 'Three' })
  const bounds = layoutBounds(readPage(dir, 'auto').elements)
  assert.ok(bounds.width > bounds.height, `a 3-node page is ${bounds.width}x${bounds.height} - a column`)
  const shapes = shapesIn(dir, 'auto')
  assert.equal(new Set(shapes.map((shape) => shape.y)).size, 1, 'the three nodes are not in one row')
})

test('a note is free text, align shares an edge, and moving a box re-anchors its arrow', () => {
  const dir = scratch()
  applyOp(dir, { op: 'page.create', page: 'ops' })
  applyOp(dir, { op: 'diagram', page: 'ops', nodes: [{ label: 'A' }, { label: 'B' }], edges: [{ from: 'n1', to: 'n2', label: 'to B' }] })
  const note = applyOp(dir, { op: 'note.add', page: 'ops', text: 'Legend: boxes are services' })
  assert.match(note.id, /^t\d+$/)
  const free = readPage(dir, 'ops').elements.find((entry) => entry.id === note.id)
  assert.equal(free.type, 'text')
  assert.equal(free.containerId, null)
  assert.equal(free.text, 'Legend: boxes are services')

  applyOp(dir, { op: 'node.move', page: 'ops', id: 'n2', x: 800, y: 300 })
  const arrow = readPage(dir, 'ops').elements.find((entry) => entry.type === 'arrow' && entry.endBinding?.elementId === 'n2')
  const target = readPage(dir, 'ops').elements.find((entry) => entry.id === 'n2')
  const endX = arrow.x + arrow.points[arrow.points.length - 1][0]
  assert.equal(Math.round(endX), Math.round(target.x), 'the arrow no longer ends on the moved box')

  applyOp(dir, { op: 'align', page: 'ops', mode: 'left', ids: ['n1', 'n2'] })
  const aligned = shapesIn(dir, 'ops')
  assert.equal(new Set(aligned.slice(0, 2).map((shape) => shape.x)).size, 1)
})

test('a diagram naming an unknown node is refused by name', () => {
  const dir = scratch()
  applyOp(dir, { op: 'page.create', page: 'bad' })
  assert.throws(
    () => applyOp(dir, { op: 'diagram', page: 'bad', nodes: [{ label: 'A' }], edges: [{ from: 'A', to: 'Ghost' }] }),
    (error) => error.code === 'unknown_node',
  )
  // Nothing was written: the page is still empty.
  assert.equal(shapesIn(dir, 'bad').length, 0)
})
