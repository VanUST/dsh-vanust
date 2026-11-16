/**
 * PROOF:
 * Behavior: `/designmap op:'overlay'` is the human's visual-write path — upsert one node's
 *   x/y/fill/stroke, reset one node, reset one view — and it writes overlays.json and
 *   nothing else. A render afterwards reflects the stored position, a partial upsert
 *   merges into the existing row, and every invalid input is refused with a named code
 *   while overlays.json keeps its bytes.
 * Fails when: the panel's only write path silently drops a key, rewrites model.yaml or
 *   out/, merges a reset too broadly, or refuses without a stable code.
 * Production path: src/command.mjs createCommandHandler -> src/host.mjs service.overlay ->
 *   src/workspace.mjs writeOverlays; reached from the panel by remote.commands.execute
 *   (SCENE-CONTRACT overlays; FR-5 event nodeMoved/colorChanged; NFR-4 layers).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCommandHandler } from '../src/command.mjs'
import { createHostService, createFileLogger } from '../src/host.mjs'
import { PALETTE } from '../src/palette.mjs'
import { TOOL_SPECS } from '../src/tools.mjs'
import { makeRepo } from './host-helpers.mjs'

const TWO_VIEWS = `schemaVersion: 1
views:
  - id: v.all
    title: Everything
    level: context
    direction: LR
    include: []
    parent: null
  - id: v.svc
    title: Services only
    level: component
    direction: TB
    include:
      - "svc.*"
    parent: null
`

function harness(repo) {
  const hostFor = () => {
    const { logger, path } = createFileLogger(repo.designmapDir)
    return { service: createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root, logger }), logger, logPath: path }
  }
  return { handler: createCommandHandler({ hostFor }), invocation: rawInput => ({ agent: { session: { header: { cwd: repo.root } } }, rawInput }) }
}

const overlaysPath = repo => join(repo.designmapDir, 'overlays.json')
const hashOf = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const readOverlays = repo => JSON.parse(readFileSync(overlaysPath(repo), 'utf8'))
/** Row keys only: `$version` is the reserved contract key, not a node row. */
const rowIds = repo => Object.keys(readOverlays(repo)).filter(key => key !== '$version')

test('upsert stores x/y/fill/stroke, a render reflects the position, and only overlays.json changes', async () => {
  const repo = makeRepo()
  try {
    const { handler, invocation } = harness(repo)
    const modelBefore = hashOf(join(repo.designmapDir, 'model.yaml'))

    const written = await handler(invocation(JSON.stringify({
      op: 'overlay', action: 'upsert', nodeId: 'svc.checkout.api',
      x: 40, y: 30, fill: PALETTE.frontend.stroke, stroke: PALETTE.frontend.stroke,
    })))
    assert.equal(written.kind, 'success', written.text)
    const row = readOverlays(repo)['svc.checkout.api']
    assert.deepEqual(row, { x: 40, y: 30, fill: PALETTE.frontend.stroke, stroke: PALETTE.frontend.stroke })

    const overlaysAfterWrite = hashOf(overlaysPath(repo))
    const rendered = await handler(invocation(JSON.stringify({ op: 'render', viewId: 'v.context' })))
    assert.equal(rendered.kind, 'success', rendered.text)
    const envelope = JSON.parse(rendered.text)
    const node = envelope.scene.nodes.find(candidate => candidate.id === 'svc.checkout.api')
    assert.equal(node.x, 40)
    assert.equal(node.y, 30)

    assert.equal(hashOf(overlaysPath(repo)), overlaysAfterWrite, 'render must not rewrite overlays.json')
    assert.equal(hashOf(join(repo.designmapDir, 'model.yaml')), modelBefore, 'overlay write must not touch model.yaml')
  } finally {
    repo.cleanup()
  }
})

test('a partial upsert merges into the existing row instead of replacing it', async () => {
  const repo = makeRepo()
  try {
    const { handler, invocation } = harness(repo)
    const send = payload => handler(invocation(JSON.stringify({ op: 'overlay', ...payload })))

    assert.equal((await send({ action: 'upsert', nodeId: 'db.orders', x: 10, y: 20, fill: PALETTE.service.fill })).kind, 'success')
    assert.equal((await send({ action: 'upsert', nodeId: 'db.orders', x: 55 })).kind, 'success')

    assert.deepEqual(readOverlays(repo)['db.orders'], { x: 55, y: 20, fill: PALETTE.service.fill })
  } finally {
    repo.cleanup()
  }
})

test('resetNode removes exactly one row', async () => {
  const repo = makeRepo()
  try {
    const { handler, invocation } = harness(repo)
    const send = payload => handler(invocation(JSON.stringify({ op: 'overlay', ...payload })))

    await send({ action: 'upsert', nodeId: 'svc.checkout.api', x: 1, y: 2 })
    await send({ action: 'upsert', nodeId: 'db.orders', x: 3, y: 4 })
    const reset = await send({ action: 'resetNode', nodeId: 'svc.checkout.api' })
    assert.equal(reset.kind, 'success', reset.text)
    assert.deepEqual(rowIds(repo), ['db.orders'])
  } finally {
    repo.cleanup()
  }
})

test('resetView removes only the rows of the nodes on that view', async () => {
  const repo = makeRepo({ views: TWO_VIEWS })
  try {
    const { handler, invocation } = harness(repo)
    const send = payload => handler(invocation(JSON.stringify({ op: 'overlay', ...payload })))

    await send({ action: 'upsert', nodeId: 'svc.checkout.api', x: 1, y: 2 })
    await send({ action: 'upsert', nodeId: 'db.orders', x: 3, y: 4 })
    assert.deepEqual(rowIds(repo).sort(), ['db.orders', 'svc.checkout.api'])

    const reset = await send({ action: 'resetView', viewId: 'v.svc' })
    assert.equal(reset.kind, 'success', reset.text)
    assert.deepEqual(rowIds(repo), ['db.orders'], 'v.svc holds only svc.* so the db row must survive')
  } finally {
    repo.cleanup()
  }
})

test('invalid overlay input is refused by code and leaves overlays.json byte-identical', async () => {
  const repo = makeRepo()
  try {
    const { handler, invocation } = harness(repo)
    const send = payload => handler(invocation(JSON.stringify({ op: 'overlay', ...payload })))
    await send({ action: 'upsert', nodeId: 'db.orders', x: 3, y: 4 })
    const before = hashOf(overlaysPath(repo))

    const cases = [
      [{ action: 'upsert', nodeId: 'ghost.node', x: 1 }, 'unknown_node'],
      [{ action: 'upsert', nodeId: 'db.orders', x: 'abc' }, 'invalid_coordinate'],
      [{ action: 'upsert', nodeId: 'db.orders', y: -5 }, 'negative_coordinate'],
      [{ action: 'upsert', nodeId: 'db.orders', fill: '#123456' }, 'colour_out_of_palette'],
      [{ action: 'upsert', nodeId: 'db.orders' }, 'invalid_overlay'],
      [{ action: 'teleport', nodeId: 'db.orders' }, 'invalid_overlay'],
      [{ action: 'resetView', viewId: 'v.nope' }, 'unknown_view'],
      [{ action: 'resetNode', nodeId: 'ghost.node' }, 'unknown_node'],
    ]
    for (const [payload, code] of cases) {
      const result = await send(payload)
      assert.equal(result.kind, 'error', `expected ${code} for ${JSON.stringify(payload)}`)
      assert.match(result.text, new RegExp(`^designmap: ${code}: `, 'u'))
    }
    assert.equal(hashOf(overlaysPath(repo)), before, 'a refused write must not change overlays.json')
    const stored = readOverlays(repo)
    assert.equal(stored['$version'], 1)
    assert.deepEqual(stored['db.orders'], { x: 3, y: 4 })
  } finally {
    repo.cleanup()
  }
})

test('a NaN coordinate is refused at the service boundary, and no overlay tool exists', async () => {
  const repo = makeRepo()
  try {
    const { logger } = createFileLogger(repo.designmapDir)
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root, logger })
    assert.throws(
      () => service.overlay({ action: 'upsert', nodeId: 'db.orders', x: Number.NaN }),
      error => error.code === 'invalid_coordinate',
    )

    const names = TOOL_SPECS.map(spec => spec.name)
    assert.equal(names.includes('designmap_overlay'), false, 'overlay writes are the human command path, never an agent tool')
    assert.deepEqual(names.sort(), [
      'designmap_apply', 'designmap_export', 'designmap_lint', 'designmap_open',
      'designmap_render', 'designmap_scan', 'designmap_status',
    ])
  } finally {
    repo.cleanup()
  }
})
