/**
 * PROOF:
 * Behavior: the apply path writes semantic ops plus the manifest atomically, an
 *   idempotent re-apply reports applied=0/skipped=N and leaves model, views and
 *   manifest byte-identical, and a coordinate/dangling-reference batch is refused with
 *   a named code before any write (FR-2, INV-NO-GEO, NFR-2, owner spec §5).
 * Fails when: coordinates pass into the model, apply writes before validating, the
 *   manifest gains a new timestamp on a no-op apply, or the tool wrapper throws instead
 *   of returning a structured refusal value.
 * Production path: src/tools.mjs designmap_apply -> src/host.mjs apply ->
 *   src/apply.mjs applyToWorkspace -> src/manifest.mjs writeManifest.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHostService } from '../src/host.mjs'
import { createHostTools } from '../src/tools.mjs'
import { createLogger } from '../src/log.mjs'
import { makeRepo, stubDefineTool } from './host-helpers.mjs'

const bytes = path => readFileSync(path, 'utf8')
const hashes = dir => ({
  model: bytes(join(dir, 'model.yaml')),
  views: bytes(join(dir, 'views.yaml')),
  manifest: bytes(join(dir, 'manifest.json')),
})

const NEW_OPS = [
  { kind: 'node', action: 'upsert', value: { id: 'queue.payments', type: 'queue', label: 'Payments queue', group: null, source: null } },
  { kind: 'edge', action: 'upsert', value: { id: 'e.api.payments', from: 'svc.checkout.api', to: 'queue.payments', kind: 'async', label: 'order.created' } },
]

test('apply writes the model and manifest; a second apply is a byte-identical no-op', () => {
  const repo = makeRepo()
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    const first = service.apply(NEW_OPS)
    assert.equal(first.ok, true)
    assert.equal(first.applied, 2)
    assert.equal(first.skipped, 0)
    assert.equal(first.written.model, true)
    assert.equal(first.written.manifest, true)
    assert.equal(first.diff.counts.added, 2)
    assert.equal(first.manifest.commit, repo.head())
    const afterFirst = hashes(repo.designmapDir)
    const manifest = JSON.parse(afterFirst.manifest)
    assert.equal(manifest.commit, repo.head())
    assert.deepEqual(Object.keys(manifest.sourceHashes).sort(), ['db.orders', 'svc.checkout.api'])

    const second = service.apply(NEW_OPS)
    assert.equal(second.applied, 0)
    assert.equal(second.skipped, 2)
    assert.equal(second.written.model, false)
    assert.equal(second.written.manifest, false)
    assert.deepEqual(hashes(repo.designmapDir), afterFirst)
    assert.equal(service.status().stale, false)
  } finally {
    repo.cleanup()
  }
})

test('a coordinate on a node op is refused with its path and nothing is written', () => {
  const repo = makeRepo()
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    service.apply([])
    const before = hashes(repo.designmapDir)
    assert.throws(
      () => service.apply([{ kind: 'node', action: 'upsert', value: { id: 'svc.new', type: 'service', label: 'New', x: 1, y: 2, fill: '#fff' } }]),
      error => error.code === 'invalid_ops'
        && error.details.issues.map(issue => issue.path.join('.')).join('|') === 'ops.0.value.x|ops.0.value.y|ops.0.value.fill',
    )
    assert.deepEqual(hashes(repo.designmapDir), before)
  } finally {
    repo.cleanup()
  }
})

test('a dangling reference refuses the batch and leaves the files unchanged', () => {
  const repo = makeRepo()
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    service.apply([])
    const before = hashes(repo.designmapDir)
    assert.throws(
      () => service.apply([
        { kind: 'node', action: 'upsert', value: { id: 'svc.new', type: 'service', label: 'New', group: null, source: null } },
        { kind: 'edge', action: 'upsert', value: { id: 'e.ghost', from: 'svc.new', to: 'ghost.node', kind: 'sync', label: 'x' } },
      ]),
      error => error.code === 'dangling_reference' && error.details.references.some(ref => ref.missing === 'ghost.node'),
    )
    assert.deepEqual(hashes(repo.designmapDir), before)
  } finally {
    repo.cleanup()
  }
})

test('the tool wrapper returns a structured refusal and logs enter/exit', async () => {
  const repo = makeRepo()
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    const logger = createLogger()
    const tools = createHostTools({
      defineTool: stubDefineTool,
      hostFor: () => ({ service, logger, logPath: null }),
    })
    const apply = tools.find(tool => tool.name === 'designmap_apply')
    const refusal = await apply.execute({ ops: [{ kind: 'node', action: 'upsert', value: { id: 'svc.a', type: 'service', label: 'A', x: 1 } }] }, { agent: undefined })
    assert.equal(refusal.ok, false)
    assert.equal(refusal.code, 'invalid_ops')
    assert.equal(refusal.details.issues[0].path.join('.'), 'ops.0.value.x')
    const events = logger.events.map(event => event.event)
    assert.deepEqual(events, ['tool.enter', 'tool.exit'])
    assert.equal(logger.find('tool.exit').ok, false)
    assert.equal(logger.find('tool.exit').code, 'invalid_ops')

    const ok = await apply.execute({ ops: NEW_OPS }, { agent: undefined })
    assert.equal(ok.ok, true)
    assert.equal(ok.applied, 2)
  } finally {
    repo.cleanup()
  }
})
