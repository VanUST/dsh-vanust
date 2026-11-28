/*
PROOF: the page's readability is measured with Excalidraw's own text fit and reported as repairs
Behavior: analyzeScene returns a score, a verdict and findings; two overlapping boxes produce
  node_overlap with both ids and a ready node.move repair; a label wider than the shape's
  inscribed text area produces label_overflow with a node.resize repair; an arrow whose label
  sits on a third box produces edge_label_on_node; a vertical page produces page_too_tall; a
  clean drawn page scores 100; readOutline carries geometry and the verdict and still never
  refuses a crowded page (hints, ok:true); lintOutline lists every finding for map_lint.
Fails when: a finding loses its element ids or its repair, the inscribed-area measurement goes
  back to the outer box (Excalidraw grows a shape whose text does not fit: textElement.ts
  redrawTextBoundingBox in v0.18.1), a crowded page throws instead of reporting, or map_read
  drops the geometry an agent needs to move a box.
Production path: plugins/designmap/src/lint.mjs (findingsOf/analyzeScene) via src/outline.mjs
  (hintsOf/readOutline/lintOutline), map_read and map_lint in src/page-tools.mjs.
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildEdge, buildNode } from '../src/elements.mjs'
import { emptyScene, writePage, readPage } from '../src/pages.mjs'
import { analyzeScene, findingsOf } from '../src/lint.mjs'
import { readOutline, lintOutline } from '../src/outline.mjs'
import { applyOp } from '../src/ops.mjs'

const scratch = () => mkdtempSync(join(tmpdir(), 'designmap-lint-'))
const sceneOf = (...parts) => ({ ...emptyScene(), elements: parts.flat() })
const nodes = (...specs) => specs.map(([id, label, x, y]) => {
  const built = buildNode({ id, label, x, y })
  return [built.shape, built.text]
})

test('two overlapping boxes are a high finding with a ready move repair', () => {
  const findings = findingsOf(sceneOf(...nodes(['a', 'Checkout API', 40, 40], ['b', 'Orders DB', 60, 50])).elements)
  const overlap = findings.find((entry) => entry.code === 'node_overlap')
  assert.ok(overlap !== undefined, 'the overlap was not found')
  assert.equal(overlap.severity, 'high')
  assert.deepEqual(overlap.elements.slice().sort(), ['a', 'b'])
  assert.equal(overlap.repair.op, 'node.move')
  assert.equal(typeof overlap.repair.x, 'number')
  assert.equal(typeof overlap.repair.y, 'number')
  assert.match(overlap.message, /overlap/)
})

test('a label that does not fit the inscribed area is a label_overflow with a resize repair', () => {
  const built = buildNode({ id: 'narrow', label: 'Orchestrator', x: 40, y: 40, width: 60, height: 40 })
  const findings = findingsOf(sceneOf([built.shape, built.text]).elements)
  const overflow = findings.find((entry) => entry.code === 'label_overflow')
  assert.ok(overflow !== undefined, 'a 60px box holding "Orchestrator" was reported readable')
  assert.equal(overflow.severity, 'high')
  assert.equal(overflow.repair.op, 'node.resize')
  assert.ok(overflow.repair.width >= 60)
})

test('an arrow label on a third box and a vertical column are named separately', () => {
  // a -> b is a horizontal arrow; c sits on its middle, so the bound label lies on c and the
  // arrow passes through it. Both are readability defects, not refusals.
  const a = buildNode({ id: 'a', label: 'A', x: 40, y: 40 })
  const b = buildNode({ id: 'b', label: 'B', x: 420, y: 40 })
  const c = buildNode({ id: 'c', label: 'C', x: 240, y: 50 })
  const edge = buildEdge({ id: 'e1', label: 'reads', from: a.shape, to: b.shape })
  const horizontal = analyzeScene(sceneOf([a.shape, a.text], [b.shape, b.text], [c.shape, c.text], [edge.arrow, edge.text]))
  assert.ok(horizontal.findings.some((entry) => entry.code === 'edge_label_on_node'), 'the label on C was not named')
  assert.ok(horizontal.findings.some((entry) => entry.code === 'edge_crosses_node'), 'the arrow through C was not named')

  const tall = analyzeScene(sceneOf(
    ...nodes(['t1', 'A', 40, 40], ['t2', 'B', 40, 220], ['t3', 'C', 40, 400]),
  ))
  assert.ok(tall.findings.some((entry) => entry.code === 'page_too_tall'), 'a 3-row column is not called tall')
  assert.equal(tall.verdict === 'broken' || tall.verdict === 'crowded', true)
})

test('a clean drawn page scores 100 and a crowded page is never refused', () => {
  const dir = scratch()
  applyOp(dir, { op: 'page.create', page: 'clean' })
  const drawn = applyOp(dir, {
    op: 'diagram',
    page: 'clean',
    nodes: [{ label: 'CLI' }, { label: 'API' }, { label: 'Store' }],
    edges: [{ from: 'CLI', to: 'API', label: 'asks' }, { from: 'API', to: 'Store', label: 'writes' }],
  })
  assert.equal(drawn.readability.score, 100)
  assert.equal(drawn.readability.verdict, 'clean')

  const crowded = sceneOf(...nodes(['a', 'Checkout API', 40, 40], ['b', 'Orders DB', 60, 50]))
  writePage(dir, 'crowded', crowded)
  const read = readOutline(readPage(dir, 'crowded'), 'crowded')
  assert.equal(read.ok, true, 'a crowded page must still read')
  assert.equal(read.hints.some((hint) => hint.kind === 'node_overlap'), true)
  assert.ok(Array.isArray(read.geometry) && read.geometry.length === 2, 'map_read lost the geometry table')
  assert.equal(typeof read.readability.score, 'number')
  const lint = lintOutline(readPage(dir, 'crowded'), 'crowded')
  assert.ok(lint.findings.length >= 1)
  assert.equal(lint.ok, true)
})

test('the geometry table carries the coordinates an agent moves a box by', () => {
  const built = buildNode({ id: 'api', label: 'API', x: 120, y: 80 })
  const read = readOutline(sceneOf([built.shape, built.text]), 'p')
  const row = read.geometry.find((entry) => entry.id === 'api')
  assert.deepEqual(row, { id: 'api', kind: 'rectangle', x: 120, y: 80, width: built.shape.width, height: built.shape.height, label: 'API' })
  assert.match(read.outline, /geometry \(id x,y w x h\):/)
  assert.match(read.outline, /- api 120,80 /)
})
