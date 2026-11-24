#!/usr/bin/env node
/**
 * The page-document demo: one page built through map_edit ops, read back, tidied and rendered.
 *
 * It is the P1 proof in one command, and it needs no harness: the op layer is the same code the
 * four tools call. Run it against a scratch directory so the repository's own pages are never
 * touched:
 *
 *   node bin/pages-demo.mjs [--dir .cache/designmap-demo]
 *
 * Prints one JSON object: the outline, the hint list of a tangled page, the overlap counts
 * before and after tidy, and the rendered SVG's path and size.
 */
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { applyOp, renderPage } from '../src/ops.mjs'
import { readOutline } from '../src/outline.mjs'
import { readPage, emptyScene, writePage } from '../src/pages.mjs'

const args = process.argv.slice(2)
const index = args.indexOf('--dir')
const designmapDir = index >= 0 && args[index + 1] !== undefined ? args[index + 1] : '.cache/designmap-demo'

rmSync(designmapDir, { recursive: true, force: true })
mkdirSync(join(designmapDir, 'pages'), { recursive: true })

applyOp(designmapDir, { op: 'page.create', page: 'checkout' })
const nodes = {}
for (const [key, label, x, y, kind] of [
  ['api', 'Checkout API', 40, 40, 'rectangle'],
  ['db', 'Orders DB', 380, 40, 'rectangle'],
  ['queue', 'Event bus', 380, 200, 'ellipse'],
  ['pay', 'Payment provider', 40, 200, 'diamond'],
]) {
  const result = applyOp(designmapDir, { op: 'node.add', page: 'checkout', label, x, y, kind })
  nodes[key] = result.id
}
applyOp(designmapDir, { op: 'edge.add', page: 'checkout', from: nodes.api, to: nodes.db, label: 'writes' })
applyOp(designmapDir, { op: 'edge.add', page: 'checkout', from: nodes.api, to: nodes.queue, label: 'publishes' })
applyOp(designmapDir, { op: 'edge.add', page: 'checkout', from: nodes.pay, to: nodes.api })
const read = readOutline(readPage(designmapDir, 'checkout'), 'checkout')

// A tangled page: two boxes on top of each other. It must READ, with a hint, not refuse.
applyOp(designmapDir, { op: 'page.create', page: 'tangled' })
applyOp(designmapDir, { op: 'node.add', page: 'tangled', label: 'Left', x: 40, y: 40 })
applyOp(designmapDir, { op: 'node.add', page: 'tangled', label: 'Right', x: 80, y: 60 })
const tangled = readOutline(readPage(designmapDir, 'tangled'), 'tangled')
const tidy = applyOp(designmapDir, { op: 'tidy', page: 'tangled' })

// An empty page is a page: no elements, no error.
writePage(designmapDir, 'empty', emptyScene())
const empty = readOutline(readPage(designmapDir, 'empty'), 'empty')

const rendered = renderPage(designmapDir, 'checkout')
process.stdout.write(JSON.stringify({
  ok: true,
  dir: designmapDir,
  outline: read.outline,
  hints: read.hints,
  tangled: { hints: tangled.hints, tidy: tidy.notes },
  empty: { nodes: empty.nodes, edges: empty.edges, outline: empty.outline, hints: empty.hints },
  rendered,
}, null, 2) + '\n')
