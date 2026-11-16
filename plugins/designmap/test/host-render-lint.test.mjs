/**
 * PROOF:
 * Behavior: render writes every scene plus out/index.json and reports the manifest
 *   staleness in the envelope; lint answers without writing; a corrected-severity
 *   error (empty edge label) makes render refuse with a named code while lint reports
 *   the finding instead of throwing (SCENE-CONTRACT envelope, §8, FR-9).
 * Fails when: render skips the index, the envelope loses scenePath/sceneHash/stale,
 *   stale flags never reach the scene, lint writes scenes, or lint crashes on an error
 *   finding.
 * Production path: src/host.mjs render/lint -> src/index-file.mjs renderAll ->
 *   src/render.mjs renderView -> src/lint.mjs.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHostService } from '../src/host.mjs'
import { DesignmapRefusal } from '../src/schema.mjs'
import { DEFAULT_FILES, DEFAULT_MODEL, DEFAULT_VIEWS, makeRepo } from './host-helpers.mjs'

test('render writes scenes + index and carries stale flags from the manifest', async () => {
  const repo = makeRepo()
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    service.apply([])
    const rendered = await service.render({})
    assert.equal(rendered.ok, true)
    assert.equal(rendered.indexPath, 'designmap/out/index.json')
    assert.match(rendered.indexHash, /^sha256:[0-9a-f]{64}$/u)
    assert.equal(rendered.views.length, 1)
    const envelope = rendered.views[0]
    assert.equal(envelope.viewId, 'v.context')
    assert.equal(envelope.scenePath, 'designmap/out/v.context.scene.json')
    assert.match(envelope.sceneHash, /^sha256:[0-9a-f]{64}$/u)
    assert.equal(envelope.scene.schemaVersion, 1)
    assert.equal(envelope.stale.stale, false)
    assert.equal(envelope.stale.commitBehind, 0)
    assert.equal(envelope.lint.ok, true)
    assert.equal(envelope.commit, repo.head())
    const onDisk = readFileSync(join(repo.root, envelope.scenePath), 'utf8')
    assert.equal(`sha256:${(await import('node:crypto')).createHash('sha256').update(onDisk).digest('hex')}`, envelope.sceneHash)
    const index = JSON.parse(readFileSync(join(repo.root, rendered.indexPath), 'utf8'))
    assert.deepEqual(index.views.map(view => view.viewId), ['v.context'])

    // A working-tree edit marks the node stale in the next render.
    repo.write('src/checkout/api.ts', 'export const api = 4\n')
    const stale = await service.render({ viewId: 'v.context' })
    assert.equal(stale.stale.stale, true)
    assert.deepEqual(stale.stale.staleNodes.map(node => node.id), ['svc.checkout.api'])
    assert.equal(stale.scene.nodes.find(node => node.id === 'svc.checkout.api').stale, true)
  } finally {
    repo.cleanup()
  }
})

test('render without viewId returns one envelope per view and the index hash', async () => {
  const views = `schemaVersion: 1
views:
  - id: v.context
    title: Context
    level: context
    direction: LR
  - id: v.flow
    title: Flow
    level: flow
    direction: TB
    include: [svc.*]
    parent: null
`
  const repo = makeRepo({ views })
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    const rendered = await service.render({})
    assert.deepEqual(rendered.views.map(view => view.viewId), ['v.context', 'v.flow'])
    assert.equal(rendered.views.every(view => typeof view.sceneHash === 'string'), true)
    assert.equal(existsSync(join(repo.root, 'designmap/out/v.flow.scene.json')), true)
  } finally {
    repo.cleanup()
  }
})

test('lint never writes scenes and reports an error finding instead of throwing', async () => {
  const repo = makeRepo({ model: DEFAULT_MODEL, views: DEFAULT_VIEWS, files: DEFAULT_FILES })
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    const clean = await service.lint({})
    assert.equal(clean.ok, true)
    assert.equal(clean.views[0].lint.ok, true)
    assert.equal(existsSync(join(repo.designmapDir, 'out')), false)

    repo.write('designmap/model.yaml', `schemaVersion: 1
groups: []
nodes:
  - id: svc.checkout.api
    type: service
    label: Checkout API
    group: null
    source: src/checkout/api.ts
  - id: db.orders
    type: datastore
    label: Orders DB
    group: null
    source: src/orders/schema.sql
edges:
  - id: e.api.db
    from: svc.checkout.api
    to: db.orders
    kind: data
    label: ""
`)
    const linted = await service.lint({ viewId: 'v.context' })
    assert.equal(linted.ok, true)
    assert.equal(linted.views[0].lint.ok, false)
    assert.equal(linted.views[0].lint.findings.some(finding => finding.rule === 'edge_label_missing' && finding.severity === 'error'), true)
    assert.equal(existsSync(join(repo.designmapDir, 'out')), false)

    await assert.rejects(
      service.render({ viewId: 'v.context' }),
      error => error instanceof DesignmapRefusal && error.code === 'missing_edge_label',
    )
  } finally {
    repo.cleanup()
  }
})
