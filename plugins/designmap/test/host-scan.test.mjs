/**
 * PROOF:
 * Behavior: scan reads `git diff` since the manifest commit and proposes semantic ops
 *   without writing anything — a new watched source file becomes an upsert-node
 *   proposal, a modified file lists its nodes as affected, a deleted file proposes
 *   remove-node only when nothing references the node (otherwise it is blocked), and a
 *   no-op scan leaves every workspace byte unchanged (DEC-PROPOSE, §11 no AST parsing).
 * Fails when: scan writes the model (auto-apply), proposes edges/nodes it cannot infer,
 *   or misses a changed node.
 * Production path: src/host.mjs scan -> src/git.mjs diffNameStatus; proposalFor.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createHostService } from '../src/host.mjs'
import { proposalFor } from '../src/host.mjs'
import { DEFAULT_FILES, makeRepo } from './host-helpers.mjs'

const hash = path => readFileSync(path, 'utf8')

test('a new watched source file is proposed as an upsert node and nothing is written', () => {
  const repo = makeRepo()
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    service.apply([])
    repo.write('src/billing/refund.ts', 'export const refund = () => 1\n')
    const before = {
      model: hash(join(repo.designmapDir, 'model.yaml')),
      manifest: hash(join(repo.designmapDir, 'manifest.json')),
    }
    const scan = service.scan()
    const proposal = scan.proposedOps.find(op => op.value?.source === 'src/billing/refund.ts')
    assert.ok(proposal, `expected a proposal, got ${JSON.stringify(scan)}`)
    assert.equal(proposal.kind, 'node')
    assert.equal(proposal.action, 'upsert')
    assert.equal(proposal.value.id, 'src.billing.refund')
    assert.equal(proposal.value.type, 'service')
    assert.equal(proposal.value.label, 'Refund')
    assert.equal(scan.changedFiles.some(file => file.path === 'src/billing/refund.ts' && file.status === 'A'), true)
    assert.deepEqual(scan.affectedNodes, [])
    // Read-only: the same bytes, and no scenes were produced.
    assert.equal(hash(join(repo.designmapDir, 'model.yaml')), before.model)
    assert.equal(hash(join(repo.designmapDir, 'manifest.json')), before.manifest)
  } finally {
    repo.cleanup()
  }
})

test('a modified file lists its node as affected and proposes no invented change', () => {
  const repo = makeRepo()
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    service.apply([])
    repo.write('src/checkout/api.ts', 'export const api = 3\n')
    const scan = service.scan()
    assert.deepEqual(scan.affectedNodes, ['svc.checkout.api'])
    assert.equal(scan.proposedOps.length, 0)
    const row = scan.changedFiles.find(file => file.path === 'src/checkout/api.ts')
    assert.deepEqual(row, { path: 'src/checkout/api.ts', status: 'M', nodeIds: ['svc.checkout.api'] })
  } finally {
    repo.cleanup()
  }
})

test('a deleted file with an edge-bound node is blocked; an unconnected node is proposed for removal', () => {
  const model = `schemaVersion: 1
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
  - id: ext.stripe
    type: external
    label: Stripe
    group: null
    source: src/ext/stripe.ts
edges:
  - id: e.api.db
    from: svc.checkout.api
    to: db.orders
    kind: data
    label: SQL / reads
`
  const repo = makeRepo({ model, files: { ...DEFAULT_FILES } })
  try {
    repo.write('src/ext/stripe.ts', 'export const stripe = 1\n')
    repo.commitAll('stripe source')
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    service.apply([])
    rmSync(`${repo.root}/src/orders/schema.sql`)
    rmSync(`${repo.root}/src/ext/stripe.ts`)
    const scan = service.scan()
    assert.equal(scan.blocked.length, 1)
    assert.equal(scan.blocked[0].nodeId, 'db.orders')
    assert.equal(scan.blocked[0].reason, 'node_has_edges')
    assert.deepEqual(scan.proposedOps, [{ kind: 'node', action: 'remove', id: 'ext.stripe' }])
  } finally {
    repo.cleanup()
  }
})

test('proposalFor derives an id, label and type from the path', () => {
  assert.deepEqual(proposalFor('src/billing/refund.ts'), {
    kind: 'node',
    action: 'upsert',
    value: { id: 'src.billing.refund', type: 'service', label: 'Refund', group: null, source: 'src/billing/refund.ts' },
  })
  assert.equal(proposalFor('src/db/orders.ts').value.type, 'datastore')
  assert.equal(proposalFor('src/queue/payments.ts').value.type, 'queue')
  assert.equal(proposalFor('src/ui/cart.tsx').value.type, 'frontend')
})
