/*
PROOF: a page file opens in the editor and reads as an outline, without refusing a crowded page
Behavior: the builders emit a shape with a bound text and an arrow with startBinding/endBinding
  and a bound label; readOutline returns text plus hints (node_overlap, edge_without_label); an
  empty page is an empty outline; tidy ranks by edge direction and removes overlaps; the SVG is
  well-formed; map_edit refuses only unknown_page and unknown_node.
Fails when: the element skeleton loses boundElements/startBinding (Excalidraw cannot bind it),
  a hint becomes a refusal, tidy stops reducing overlaps, or an op addresses elements by a
  parallel id space instead of the id map_read returned.
Production path: plugins/designmap/src/pages.mjs, elements.mjs, outline.mjs, tidy.mjs, svg.mjs,
  ops.mjs and plugins/designmap/bin/pages-demo.mjs (the product run).
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyScene, readPage, writePage, listPages } from '../src/pages.mjs'
import { buildEdge, buildNode, labelOf } from '../src/elements.mjs'
import { readOutline } from '../src/outline.mjs'
import { tidyElements } from '../src/tidy.mjs'
import { applyOp } from '../src/ops.mjs'

const scratch = () => mkdtempSync(join(tmpdir(), 'designmap-v2-'))

test('a node is a shape with a bound text, and the caller passed no seed or binding', () => {
  const { shape, text } = buildNode({ id: 'n1', label: 'Checkout API', x: 10, y: 20 })
  assert.equal(shape.type, 'rectangle')
  assert.deepEqual(shape.boundElements, [{ type: 'text', id: 'n1:label' }])
  assert.equal(text.containerId, 'n1')
  assert.equal(text.text, 'Checkout API')
  assert.ok(Number.isFinite(shape.seed) && shape.seed > 0)
  assert.ok(shape.width >= 140 && shape.height >= 56)
  assert.equal(buildNode({ id: 'n2', label: 'x', x: 0, y: 0 }).shape.seed, buildNode({ id: 'n2', label: 'x', x: 0, y: 0 }).shape.seed)
})

test('an edge is a bound arrow with a bound label', () => {
  const from = buildNode({ id: 'a', label: 'A', x: 0, y: 0 }).shape
  const to = buildNode({ id: 'b', label: 'B', x: 400, y: 0 }).shape
  const { arrow, text } = buildEdge({ id: 'e1', label: 'writes', from, to })
  assert.equal(arrow.type, 'arrow')
  assert.deepEqual(arrow.startBinding, { elementId: 'a', focus: 0, gap: 1 })
  assert.deepEqual(arrow.endBinding, { elementId: 'b', focus: 0, gap: 1 })
  assert.equal(arrow.points.length, 2)
  assert.deepEqual(arrow.boundElements, [{ type: 'text', id: 'e1:label' }])
  assert.equal(text.containerId, 'e1')
})

test('the outline is text by default and a crowded page hints instead of refusing', () => {
  const a = buildNode({ id: 'n1', label: 'Left', x: 40, y: 40 })
  const b = buildNode({ id: 'n2', label: 'Right', x: 60, y: 50 })
  const scene = { ...emptyScene(), elements: [a.shape, a.text, b.shape, b.text] }
  const read = readOutline(scene, 'p')
  assert.match(read.outline, /- \[box\] Left  n1/)
  assert.equal(read.nodes, 2)
  assert.equal(read.hints.some((hint) => hint.kind === 'node_overlap'), true)
  const arrow = buildEdge({ id: 'e1', from: a.shape, to: b.shape, label: '' })
  const withEdge = readOutline({ ...emptyScene(), elements: [a.shape, a.text, b.shape, b.text, arrow.arrow] }, 'p')
  assert.equal(withEdge.hints.some((hint) => hint.kind === 'edge_without_label'), true)
})

test('tidy ranks by edge direction and removes the overlaps', () => {
  const a = buildNode({ id: 'a', label: 'A', x: 0, y: 0 })
  const b = buildNode({ id: 'b', label: 'B', x: 10, y: 10 })
  const edge = buildEdge({ id: 'e', from: a.shape, to: b.shape, label: 'to B' })
  const result = tidyElements([a.shape, a.text, b.shape, b.text, edge.arrow, edge.text])
  assert.ok(result.overlapsBefore > 0)
  assert.equal(result.overlapsAfter, 0)
  const left = result.elements.find((entry) => entry.id === 'a')
  const right = result.elements.find((entry) => entry.id === 'b')
  assert.ok(right.x > left.x + left.width, 'the target sits in a later layer')
})

test('a page is one scene file; an empty page reads as an empty outline', () => {
  const dir = scratch()
  writePage(dir, 'empty', emptyScene())
  const scene = readPage(dir, 'empty')
  assert.equal(scene.type, 'excalidraw')
  assert.deepEqual(scene.elements, [])
  assert.equal(readOutline(scene, 'empty').outline, 'page: empty — 0 node(s), 0 edge(s)')
  assert.deepEqual(listPages(dir).map((row) => row.page), ['empty'])
})

test('map_edit builds every element from ops and refuses only unknown page and node', () => {
  const dir = scratch()
  applyOp(dir, { op: 'page.create', page: 'p' })
  const added = applyOp(dir, { op: 'node.add', page: 'p', label: 'API', x: 40, y: 40 })
  assert.match(added.id, /^n\d+$/)
  assert.equal(labelOf(readPage(dir, 'p').elements, added.id), 'API')
  assert.throws(() => applyOp(dir, { op: 'node.move', page: 'p', id: 'nope', x: 0, y: 0 }), (error) => error.code === 'unknown_node')
  assert.throws(() => applyOp(dir, { op: 'tidy', page: 'missing' }), (error) => error.code === 'unknown_page')
})


