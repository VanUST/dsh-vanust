/**
 * PROOF:
 * Behavior: apply is all-or-nothing — a batch that would introduce a dangling
 *   reference is refused and leaves model.yaml/views.yaml byte-identical, a valid
 *   batch writes canonical files, and re-applying the same batch reports
 *   applied:0/skipped:N without touching the bytes (FR-2, NFR-2, INV-ID).
 * Fails when: writes happen before whole-document validation, an op silently
 *   creates a reference to a missing node, or the second apply rewrites the files.
 * Production path: src/apply.mjs applyToWorkspace -> applyOps -> parseModel/
 *   parseViews -> assertReferences -> src/workspace.mjs writeModel.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyToWorkspace } from '../src/apply.mjs'
import { createWorkspace } from '../src/workspace.mjs'

const demo = fileURLToPath(new URL('../fixtures/demo', import.meta.url))

function scratchWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'designmap-apply-'))
  cpSync(demo, root, { recursive: true })
  rmSync(join(root, 'overlays.json'))
  return { root, workspace: createWorkspace(root) }
}

const changedHashes = workspace => ({ model: workspace.hashOf('model'), views: workspace.hashOf('views') })

test('a semantic batch writes canonical files and a repeat is a no-op', () => {
  const { root, workspace } = scratchWorkspace()
  try {
    const before = changedHashes(workspace)
    const ops = [
      { kind: 'node', action: 'upsert', value: { id: 'db.audit', type: 'datastore', label: 'Audit log', source: null } },
      { kind: 'edge', action: 'upsert', value: { id: 'e.worker.audit', from: 'svc.checkout.worker', to: 'db.audit', kind: 'async', label: 'append' } },
    ]
    const first = applyToWorkspace(workspace, ops)
    assert.equal(first.applied, 2)
    assert.equal(first.skipped, 0)
    assert.equal(first.written.model, true)
    assert.notEqual(workspace.hashOf('model'), before.model)
    assert.equal(first.diff.counts.added, 2)
    assert.equal(workspace.readModel().model.nodes.some(node => node.id === 'db.audit'), true)

    const afterFirst = changedHashes(workspace)
    const second = applyToWorkspace(workspace, ops)
    assert.equal(second.applied, 0)
    assert.equal(second.skipped, 2)
    assert.equal(second.written.model, false)
    assert.deepEqual(changedHashes(workspace), afterFirst)
    assert.equal(second.diff.counts.added + second.diff.counts.removed + second.diff.counts.changed, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an op that dangles is refused as a whole and the files stay byte-identical', () => {
  const { root, workspace } = scratchWorkspace()
  try {
    const before = changedHashes(workspace)
    const modelText = readFileSync(join(root, 'model.yaml'), 'utf8')
    assert.throws(
      () => applyToWorkspace(workspace, [
        { kind: 'node', action: 'upsert', value: { id: 'svc.new', type: 'service', label: 'New', source: null } },
        { kind: 'edge', action: 'upsert', value: { id: 'e.ghost', from: 'svc.new', to: 'ghost.node', kind: 'sync', label: 'x' } },
      ]),
      error => error.code === 'dangling_reference' && error.details.references.some(ref => ref.missing === 'ghost.node'),
    )
    assert.deepEqual(changedHashes(workspace), before)
    assert.equal(readFileSync(join(root, 'model.yaml'), 'utf8'), modelText)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('removing a node that edges still need is refused, not half-applied', () => {
  const { root, workspace } = scratchWorkspace()
  try {
    const before = changedHashes(workspace)
    assert.throws(
      () => applyToWorkspace(workspace, [{ kind: 'node', action: 'remove', id: 'svc.checkout.api' }]),
      error => error.code === 'dangling_reference' && error.details.references.length >= 2,
    )
    assert.deepEqual(changedHashes(workspace), before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an invalid model document is refused by the same write path with its path', () => {
  const { root, workspace } = scratchWorkspace()
  try {
    const before = changedHashes(workspace)
    assert.throws(
      () => applyToWorkspace(workspace, [
        { kind: 'node', action: 'upsert', value: { id: 'svc.x', type: 'service', label: 'X', source: null, x: 1 } },
      ]),
      error => error.code === 'invalid_ops' && error.details.issues[0].path.join('.') === 'ops.0.value.x',
    )
    assert.deepEqual(changedHashes(workspace), before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unvalidated model carrying geometry is refused before any op is applied', () => {
  const { root, workspace } = scratchWorkspace()
  try {
    const dirtyModel = workspace.readModel().model
    dirtyModel.nodes[0] = { ...dirtyModel.nodes[0], x: 5 }
    assert.throws(
      () => applyToWorkspace(Object.assign(Object.create(Object.getPrototypeOf(workspace)), workspace, {
        readModel: () => ({ model: dirtyModel, text: '', hash: null, missing: false }),
      }), [{ kind: 'node', action: 'remove', id: 'db.orders' }]),
      error => error.code === 'invalid_model' && error.details.issues[0].path.join('.') === 'nodes.0.x',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a remove of an unknown id is skipped, not an error', () => {
  const { root, workspace } = scratchWorkspace()
  try {
    const result = applyToWorkspace(workspace, [{ kind: 'edge', action: 'remove', id: 'e.missing' }])
    assert.equal(result.applied, 0)
    assert.equal(result.skipped, 1)
    assert.equal(result.written.model, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
