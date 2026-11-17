/**
 * PROOF:
 * Behavior: `designmap_apply` records a semantic revision in `designmap/manifest.json` — it
 *   rises by one only when the canonical model content changes, a repeated apply leaves the
 *   manifest byte-identical, a views-only edit does not move it, and the first manifest
 *   continues the retired `design.excalidraw` numbering (30 → 31) so existing analysis
 *   records at `mapRev: 30` are not reported as drifted (D3, docs/analysis/kit-integrity-p0.json).
 * Fails when: the revision counts writes instead of content, a no-op apply rewrites the
 *   manifest, a reformatted-but-equal model.yaml bumps the revision, or the first manifest
 *   starts at 1 instead of continuing the old scene.
 * Production path: src/tools.mjs designmap_apply -> src/host.mjs apply ->
 *   src/apply.mjs applyToWorkspace -> src/manifest.mjs buildManifest/writeManifest.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHostService } from '../src/host.mjs'
import { createHostTools } from '../src/tools.mjs'
import { createLogger } from '../src/log.mjs'
import { makeRepo, stubDefineTool } from './host-helpers.mjs'

const NEW_OPS = [
  { kind: 'node', action: 'upsert', value: { id: 'queue.payments', type: 'queue', label: 'Payments queue', group: null, source: null } },
  { kind: 'edge', action: 'upsert', value: { id: 'e.api.payments', from: 'svc.checkout.api', to: 'queue.payments', kind: 'async', label: 'order.created' } },
]
const SECOND_OPS = [
  { kind: 'node', action: 'upsert', value: { id: 'queue.payments', type: 'queue', label: 'Payments queue', group: null, source: null } },
  { kind: 'node', action: 'upsert', value: { id: 'svc.ledger', type: 'service', label: 'Ledger', group: null, source: null } },
]
const VIEW_OP = [
  { kind: 'view', action: 'upsert', value: { id: 'v.new', title: 'New view', level: 'container', direction: 'LR', include: [], parent: null } },
]

const manifestPath = repo => join(repo.designmapDir, 'manifest.json')
const manifestOf = repo => JSON.parse(readFileSync(manifestPath(repo), 'utf8'))
const manifestBytes = repo => readFileSync(manifestPath(repo), 'utf8')

const EXCALIDRAW_30 = `${JSON.stringify({ type: 'excalidraw', designMap: { rev: 30, updatedAt: '2026-11-16T09:24:44.830Z', updatedBy: 'human' } }, null, 2)}\n`
const FIXTURE_FILES = {
  'src/checkout/api.ts': 'export const api = 1\n',
  'src/orders/schema.sql': 'create table orders(id int);\n',
  'design.excalidraw': EXCALIDRAW_30,
}

test('the first manifest continues the old scene revision: 30 → 31 on a semantic change', () => {
  const repo = makeRepo({ files: FIXTURE_FILES })
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    const first = service.apply(NEW_OPS)
    assert.equal(first.ok, true)
    assert.equal(first.written.model, true)
    assert.equal(first.manifest.rev, 31, 'the old scene at 30 must seed the counter, and this apply changed the model')
    const manifest = manifestOf(repo)
    assert.equal(manifest.rev, 31)
    assert.match(manifest.modelHash, /^sha256:[0-9a-f]{64}$/)
  } finally {
    repo.cleanup()
  }
})

test('the designmap_apply tool reports the revision and a repeated call leaves the file identical', async () => {
  const repo = makeRepo({ files: FIXTURE_FILES })
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    const logger = createLogger()
    const tools = createHostTools({ defineTool: stubDefineTool, hostFor: () => ({ service, logger, logPath: null }) })
    const apply = tools.find(tool => tool.name === 'designmap_apply')
    const first = await apply.execute({ ops: NEW_OPS }, { agent: undefined })
    assert.equal(first.ok, true)
    assert.equal(first.manifest.rev, 31)
    const bytes = manifestBytes(repo)
    const second = await apply.execute({ ops: NEW_OPS }, { agent: undefined })
    assert.equal(second.ok, true)
    assert.equal(second.manifest.rev, 31)
    assert.equal(manifestBytes(repo), bytes)
  } finally {
    repo.cleanup()
  }
})

test('a repeated apply keeps the revision and leaves the manifest byte-identical', () => {
  const repo = makeRepo({ files: FIXTURE_FILES })
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    const first = service.apply(NEW_OPS)
    assert.equal(first.manifest.rev, 31)
    const bytes = manifestBytes(repo)
    const second = service.apply(NEW_OPS)
    assert.equal(second.written.model, false)
    assert.equal(second.written.manifest, false)
    assert.equal(second.manifest.rev, first.manifest.rev)
    assert.equal(manifestBytes(repo), bytes)
  } finally {
    repo.cleanup()
  }
})

test('a second semantic change moves the revision once more; a views-only edit does not', () => {
  const repo = makeRepo({ files: FIXTURE_FILES })
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    assert.equal(service.apply(NEW_OPS).manifest.rev, 31)
    const second = service.apply(SECOND_OPS)
    assert.equal(second.written.model, true)
    assert.equal(second.manifest.rev, 32)
    const viewsOnly = service.apply(VIEW_OP)
    assert.equal(viewsOnly.written.views, true)
    assert.equal(viewsOnly.manifest.rev, 32, 'adding a view is not a semantic model change')
  } finally {
    repo.cleanup()
  }
})

test('reformatting model.yaml without changing semantics does not move the revision', () => {
  const repo = makeRepo({ files: FIXTURE_FILES })
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    assert.equal(service.apply(NEW_OPS).manifest.rev, 31)
    // Reorder the two nodes and re-indent: the canonical model is the same document.
    repo.write('designmap/model.yaml', `schemaVersion: 1
groups: []
nodes:
  - {id: svc.checkout.api, type: service, label: Checkout API, group: null, source: src/checkout/api.ts}
  - {id: db.orders, type: datastore, label: Orders DB, group: null, source: src/orders/schema.sql}
  - {id: queue.payments, type: queue, label: Payments queue, group: null, source: null}
edges:
  - {id: e.api.db, from: svc.checkout.api, to: db.orders, kind: data, label: SQL / reads}
  - {id: e.api.payments, from: svc.checkout.api, to: queue.payments, kind: async, label: order.created}
`)
    const revision = service.apply([{ kind: 'node', action: 'upsert', value: { id: 'queue.payments', type: 'queue', label: 'Payments queue', group: null, source: null } }])
    assert.equal(revision.written.model, false)
    assert.equal(revision.manifest.rev, 31)
  } finally {
    repo.cleanup()
  }
})

test('a manifest written before the revision existed takes the next number', () => {
  const repo = makeRepo({ files: FIXTURE_FILES })
  try {
    // The 0.1.17 shape: no rev, no modelHash.
    repo.write('designmap/manifest.json', `${JSON.stringify({ schemaVersion: 1, commit: repo.head(), generatedAt: '2026-11-16T10:00:00.000Z', sourceHashes: {} }, null, 2)}\n`)
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    const applied = service.apply(NEW_OPS)
    assert.equal(applied.written.model, true)
    assert.equal(applied.manifest.rev, 31)
    assert.match(manifestOf(repo).modelHash, /^sha256:/)
  } finally {
    repo.cleanup()
  }
})

test('without the old scene the numbering starts from the first real change', () => {
  const repo = makeRepo()
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    assert.equal(service.apply(NEW_OPS).manifest.rev, 1)
    assert.equal(service.apply(SECOND_OPS).manifest.rev, 2)
  } finally {
    repo.cleanup()
  }
})
