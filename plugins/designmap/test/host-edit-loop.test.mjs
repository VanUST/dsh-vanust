/**
 * PROOF:
 * Behavior: the panel's read path (`op:'views'`) returns every view RENDERED WITH the
 *   stored overlays — a moved node, its re-anchored edge endpoints and its label plates —
 *   and writes nothing; an overlay move that would land on another node is auto-placed
 *   into the nearest free cell and reports it; a human label edit goes through `apply`
 *   into the model and rebuilds the manifest, while an empty edge label is refused and
 *   leaves every file byte-identical.
 * Fails when: the panel is served the pinned out/ scene again (arrows detach), the
 *   auto-placement silently moves an unrelated row or writes a negative coordinate, or
 *   the label path bypasses apply and can write an unrenderable model.
 * Production path: src/command.mjs createCommandHandler -> src/host.mjs panelViews /
 *   overlay (autoPlace) / label -> src/render.mjs renderView, src/overlays.mjs
 *   findFreeSpot, src/apply.mjs; reached from the panel by remote.commands.execute.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createCommandHandler } from '../src/command.mjs'
import { createHostService, createFileLogger } from '../src/host.mjs'
import { boxesWithinGap } from '../src/overlays.mjs'
import { makeRepo } from './host-helpers.mjs'

function harness(repo) {
  const hostFor = () => {
    const { logger, path } = createFileLogger(repo.designmapDir)
    return { service: createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root, logger }), logger, logPath: path }
  }
  return {
    handler: createCommandHandler({ hostFor }),
    invocation: rawInput => ({ agent: { session: { header: { cwd: repo.root } } }, rawInput }),
  }
}

const hashOf = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const readOverlays = repo => JSON.parse(readFileSync(join(repo.designmapDir, 'overlays.json'), 'utf8'))
const readModel = repo => readFileSync(join(repo.designmapDir, 'model.yaml'), 'utf8')

/** Is the point on the rectangle's boundary (the SCENE-CONTRACT endpoint rule)? */
function onBoundary(point, box, tolerance = 0.75) {
  const withinX = point.x >= box.x - tolerance && point.x <= box.x + box.w + tolerance
  const withinY = point.y >= box.y - tolerance && point.y <= box.y + box.h + tolerance
  const onVertical = Math.abs(point.x - box.x) <= tolerance || Math.abs(point.x - (box.x + box.w)) <= tolerance
  const onHorizontal = Math.abs(point.y - box.y) <= tolerance || Math.abs(point.y - (box.y + box.h)) <= tolerance
  return (onVertical && withinY) || (onHorizontal && withinX)
}

test('views renders every view with the overlays applied and writes nothing', async () => {
  const repo = makeRepo()
  try {
    const { handler, invocation } = harness(repo)
    const send = payload => handler(invocation(JSON.stringify(payload)))

    const first = await send({ op: 'views' })
    assert.equal(first.kind, 'success', first.text)
    const loaded = JSON.parse(first.text)
    assert.equal(loaded.views.length, 1)
    assert.equal(loaded.rootId, 'v.context')
    assert.equal(loaded.overlays.path, 'designmap/overlays.json')
    const apiBefore = loaded.views[0].scene.nodes.find(node => node.id === 'svc.checkout.api')
    const outBefore = existsSync(join(repo.designmapDir, 'out'))
      ? readdirSync(join(repo.designmapDir, 'out')).sort()
      : null

    const moved = await send({ op: 'overlay', action: 'upsert', nodeId: 'svc.checkout.api', x: 320, y: 400 })
    assert.equal(moved.kind, 'success', moved.text)
    assert.equal(JSON.parse(moved.text).adjusted, null, 'a free position must not be adjusted')

    const second = await send({ op: 'views' })
    assert.equal(second.kind, 'success', second.text)
    const scene = JSON.parse(second.text).views[0].scene
    const api = scene.nodes.find(node => node.id === 'svc.checkout.api')
    assert.equal(api.x, 320)
    assert.equal(api.y, 400)
    assert.notEqual(api.x, apiBefore.x, 'the overlay position must be the one the panel draws')

    const edge = scene.edges[0]
    assert.equal(onBoundary(edge.points[0], api), true, `edge start ${JSON.stringify(edge.points[0])} is not on the moved node boundary`)
    const db = scene.nodes.find(node => node.id === 'db.orders')
    assert.equal(onBoundary(edge.points.at(-1), db), true, 'the unmoved endpoint must stay on its node')

    const outAfter = existsSync(join(repo.designmapDir, 'out'))
      ? readdirSync(join(repo.designmapDir, 'out')).sort()
      : null
    assert.deepEqual(outAfter, outBefore, 'views is a read path and must not write out/')

    const third = await send({ op: 'views' })
    assert.equal(
      JSON.parse(third.text).views[0].meta.sceneHash,
      JSON.parse(second.text).views[0].meta.sceneHash,
      'the same model+overlays must render the same scene hash',
    )
  } finally {
    repo.cleanup()
  }
})

test('an overlay move onto another node is auto-placed into the nearest free cell', async () => {
  const repo = makeRepo()
  try {
    const { handler, invocation } = harness(repo)
    const send = payload => handler(invocation(JSON.stringify(payload)))

    const loaded = JSON.parse((await send({ op: 'views' })).text)
    const obstacle = loaded.views[0].scene.nodes.find(node => node.id === 'svc.checkout.api')
    const target = loaded.views[0].scene.nodes.find(node => node.id === 'db.orders')
    const overlaysBefore = existsSync(join(repo.designmapDir, 'overlays.json')) ? hashOf(join(repo.designmapDir, 'overlays.json')) : null

    const dropped = await send({ op: 'overlay', action: 'upsert', nodeId: 'db.orders', x: obstacle.x, y: obstacle.y })
    assert.equal(dropped.kind, 'success', dropped.text)
    const result = JSON.parse(dropped.text)
    assert.notEqual(result.adjusted, null, 'a drop on top of another node must be reported as adjusted')
    assert.equal(result.finding.code, 'overlap_adjusted')

    const row = readOverlays(repo)['db.orders']
    assert.equal(row.x, result.adjusted.x)
    assert.equal(row.y, result.adjusted.y)
    const placed = { x: row.x, y: row.y, w: target.w, h: target.h }
    assert.equal(boxesWithinGap(placed, obstacle, 8), false, 'the auto-placed box must keep the gap from its neighbour')
    assert.equal(row.x >= 0 && row.y >= 0, true, 'auto-placement must never write a negative coordinate')
    assert.equal(Object.keys(readOverlays(repo)).filter(key => key !== '$version').length, 1, 'only the edited node gets a row')
    assert.notEqual(overlaysBefore, hashOf(join(repo.designmapDir, 'overlays.json')), 'the adjusted row must be stored')

    // A colour-only upsert has no position and must never be auto-placed.
    const coloured = await send({ op: 'overlay', action: 'upsert', nodeId: 'db.orders', fill: '#e2e8f0' })
    assert.equal(JSON.parse(coloured.text).adjusted, null)
    assert.deepEqual(readOverlays(repo)['db.orders'], { x: row.x, y: row.y, fill: '#e2e8f0' })
  } finally {
    repo.cleanup()
  }
})

test('a one-axis move that lands on a neighbour is still auto-placed', async () => {
  const repo = makeRepo()
  try {
    const { handler, invocation } = harness(repo)
    const send = payload => handler(invocation(JSON.stringify(payload)))
    const loaded = JSON.parse((await send({ op: 'views' })).text)
    const obstacle = loaded.views[0].scene.nodes.find(node => node.id === 'svc.checkout.api')
    const target = loaded.views[0].scene.nodes.find(node => node.id === 'db.orders')

    // Only x travels: the effective y is the scene's, and the box still lands on the API.
    const dropped = await send({ op: 'overlay', action: 'upsert', nodeId: 'db.orders', x: obstacle.x })
    assert.equal(dropped.kind, 'success', dropped.text)
    const result = JSON.parse(dropped.text)
    assert.notEqual(result.adjusted, null, 'the effective box must be checked even for a one-axis move')
    const row = readOverlays(repo)['db.orders']
    assert.deepEqual(row, { x: result.adjusted.x, y: result.adjusted.y })
    assert.equal(boxesWithinGap({ ...row, w: target.w, h: target.h }, obstacle, 8), false)

    // A one-axis move into free space keeps the partial row (no extra axis is invented).
    const clear = await send({ op: 'overlay', action: 'upsert', nodeId: 'db.orders', x: 640 })
    assert.equal(clear.kind, 'success', clear.text)
    assert.equal(JSON.parse(clear.text).adjusted, null)
    assert.deepEqual(readOverlays(repo)['db.orders'], { x: 640, y: row.y })
  } finally {
    repo.cleanup()
  }
})

test('the human label edit goes through apply into the model and rebuilds the manifest', async () => {
  const repo = makeRepo()
  try {
    const { handler, invocation } = harness(repo)
    const send = payload => handler(invocation(JSON.stringify(payload)))
    const manifestPath = join(repo.designmapDir, 'manifest.json')
    const manifestBefore = existsSync(manifestPath) ? hashOf(manifestPath) : null

    const node = await send({ op: 'label', kind: 'node', id: 'svc.checkout.api', label: 'Checkout API (renamed)' })
    assert.equal(node.kind, 'success', node.text)
    assert.match(readModel(repo), /label: Checkout API \(renamed\)/u)
    assert.equal(existsSync(manifestPath), true, 'apply must write the manifest')
    assert.notEqual(hashOf(manifestPath), manifestBefore, 'apply must rebuild the manifest')

    const edge = await send({ op: 'label', kind: 'edge', id: 'e.api.db', label: 'SQL / writes' })
    assert.equal(edge.kind, 'success', edge.text)
    assert.match(readModel(repo), /label: SQL \/ writes/u)

    const loaded = JSON.parse((await send({ op: 'views' })).text)
    assert.equal(loaded.views[0].scene.nodes.find(row => row.id === 'svc.checkout.api').label, 'Checkout API (renamed)')
    assert.equal(loaded.views[0].scene.edges[0].label, 'SQL / writes')
  } finally {
    repo.cleanup()
  }
})

test('an empty edge label is refused by code and leaves the model and views byte-identical', async () => {
  const repo = makeRepo()
  try {
    const { handler, invocation } = harness(repo)
    const send = payload => handler(invocation(JSON.stringify(payload)))
    const modelBefore = hashOf(join(repo.designmapDir, 'model.yaml'))
    const viewsBefore = hashOf(join(repo.designmapDir, 'views.yaml'))

    const empty = await send({ op: 'label', kind: 'edge', id: 'e.api.db', label: '   ' })
    assert.equal(empty.kind, 'error')
    assert.match(empty.text, /^designmap: missing_edge_label: /u, empty.text)

    const emptyNode = await send({ op: 'label', kind: 'node', id: 'svc.checkout.api', label: '' })
    assert.equal(emptyNode.kind, 'error')
    assert.match(emptyNode.text, /^designmap: invalid_label: /u)

    const ghost = await send({ op: 'label', kind: 'node', id: 'ghost', label: 'x' })
    assert.match(ghost.text, /^designmap: unknown_node: /u)

    assert.equal(hashOf(join(repo.designmapDir, 'model.yaml')), modelBefore, 'a refused label must not change model.yaml')
    assert.equal(hashOf(join(repo.designmapDir, 'views.yaml')), viewsBefore, 'a refused label must not change views.yaml')
    assert.equal(readModel(repo).includes('Checkout API'), true)
  } finally {
    repo.cleanup()
  }
})
