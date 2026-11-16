/**
 * PROOF:
 * Behavior: status answers "did the code move under the map?" — a missing manifest is
 *   stale=true with a warning, a manifest synced by apply is clean, an uncommitted
 *   source edit marks the node stale (source_changed), and a new commit makes
 *   commitBehind>0 (owner spec §9 living-doc cycle, SCENE-CONTRACT stale rule).
 * Fails when: status treats a missing manifest as an error, ignores the working tree
 *   (only comparing commits), or fails to name the affected node.
 * Production path: src/host.mjs status -> src/manifest.mjs -> src/git.mjs.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createHostService } from '../src/host.mjs'
import { makeRepo } from './host-helpers.mjs'

test('a missing manifest is stale with a warning, not an error', () => {
  const repo = makeRepo()
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    const status = service.status()
    assert.equal(status.ok, true)
    assert.equal(status.stale, true)
    assert.equal(status.missingManifest, true)
    assert.ok(status.warnings.includes('manifest_missing'))
    assert.deepEqual(status.staleNodes.map(node => node.id).sort(), ['db.orders', 'svc.checkout.api'])
    assert.equal(status.staleNodes.every(node => node.reason === 'no_manifest'), true)
  } finally {
    repo.cleanup()
  }
})

test('after apply the manifest is clean; a working-tree edit marks exactly that node', () => {
  const repo = makeRepo()
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    const applied = service.apply([])
    assert.equal(applied.ok, true)
    assert.equal(applied.written.manifest, true)
    let status = service.status()
    assert.equal(status.stale, false)
    assert.equal(status.commit, repo.head())
    assert.equal(status.commitBehind, 0)

    // A real source edit, not committed yet: only the source hash can see it.
    repo.write('src/checkout/api.ts', 'export const api = 2\n')
    status = service.status()
    assert.equal(status.stale, true)
    assert.deepEqual(status.staleNodes, [{ id: 'svc.checkout.api', source: 'src/checkout/api.ts', reason: 'source_changed' }])
    assert.equal(status.staleNodeIds.join(','), 'svc.checkout.api')
  } finally {
    repo.cleanup()
  }
})

test('a committed edit shows up as commitBehind, and a deleted source as source_missing', () => {
  const repo = makeRepo()
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    service.apply([])
    repo.write('src/orders/schema.sql', 'create table orders(id int, total int);\n')
    repo.commitAll('orders total')
    let status = service.status()
    assert.equal(status.commitBehind, 1)
    assert.equal(status.stale, true)
    assert.deepEqual(status.staleNodes, [{ id: 'db.orders', source: 'src/orders/schema.sql', reason: 'source_changed' }])

    // Sync the map to the new commit, then delete the file without touching git state.
    service.apply([])
    assert.equal(service.status().stale, false)
    rmSync(`${repo.root}/src/orders/schema.sql`)
    status = service.status()
    assert.deepEqual(status.staleNodes, [{ id: 'db.orders', source: 'src/orders/schema.sql', reason: 'source_missing' }])
  } finally {
    repo.cleanup()
  }
})
