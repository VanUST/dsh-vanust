/**
 * PROOF:
 * Behavior: workspace YAML IO is canonical and lossless for the model shape — a
 *   multiline label survives read/write as one string, a `|` block scalar's trailing
 *   newline is normalised away, duplicate mapping keys are refused, and a second write
 *   of unchanged content is byte-identical (API-TESTS-CORE.md §3, INV-IDEMPOTENT).
 * Fails when: the emitter uses the default 80-column folding, a block scalar keeps its
 *   trailing newline into the scene, duplicate keys pass silently, or write order is
 *   unstable.
 * Production path: src/workspace.mjs modelYaml/parseModelText/writeModel.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspace, modelYaml, parseModelText } from '../src/workspace.mjs'
import { parseModel } from '../src/schema.mjs'

const LONG = 'Checkout API accepts orders from the storefront and reserves stock before payment is captured'

test('a multiline label round-trips as one string and emits a block scalar', () => {
  const model = parseModel({
    schemaVersion: 1,
    groups: [],
    nodes: [{ id: 'svc.a', type: 'service', label: 'Checkout API\naccepts orders', group: null, source: null }],
    edges: [],
  })
  const text = modelYaml(model)
  assert.match(text, /label: \|-/u)
  const again = parseModelText(text)
  assert.equal(again.nodes[0].label, 'Checkout API\naccepts orders')
})

test('a | block scalar keeps a trailing newline; the reader normalises it away', () => {
  const text = 'schemaVersion: 1\ngroups: []\nnodes:\n  - id: svc.a\n    type: service\n    label: |\n      first\n      second\n    group: null\n    source: null\nedges: []\n'
  const model = parseModelText(text)
  assert.equal(model.nodes[0].label, 'first\nsecond')
  assert.equal(model.nodes[0].label.endsWith('\n'), false)
})

test('duplicate mapping keys are refused, not merged', () => {
  const text = 'schemaVersion: 1\ngroups: []\nnodes:\n  - id: svc.a\n    type: service\n    label: A\n    group: null\n    source: null\nedges: []\nnodes: []\n'
  assert.throws(() => parseModelText(text), error => error.code === 'invalid_model' && /unique/iu.test(error.message))
})

test('the emitter does not fold a long single-line label at 80 columns', () => {
  const model = parseModel({
    schemaVersion: 1,
    groups: [],
    nodes: [{ id: 'svc.a', type: 'service', label: LONG, group: null, source: null }],
    edges: [],
  })
  const text = modelYaml(model)
  assert.ok(text.includes(LONG), `long label was folded:\n${text}`)
  assert.equal(parseModelText(text).nodes[0].label, LONG)
})

test('writing the same model twice is byte-identical and reading it back is stable', () => {
  const root = mkdtempSync(join(tmpdir(), 'designmap-yaml-'))
  try {
    const workspace = createWorkspace(root)
    const model = parseModel({
      schemaVersion: 1,
      groups: [{ id: 'grp.a', label: 'A' }],
      nodes: [
        { id: 'svc.b', type: 'service', label: 'B', group: 'grp.a', source: null },
        { id: 'svc.a', type: 'service', label: 'A', group: null, source: 'src/a.ts' },
      ],
      edges: [],
    })
    const first = workspace.writeModel(model)
    const bytes = readFileSync(join(root, 'model.yaml'), 'utf8')
    assert.ok(bytes.indexOf('id: svc.a') < bytes.indexOf('id: svc.b'), 'nodes are emitted sorted by id')
    const second = workspace.writeModel(workspace.readModel().model)
    assert.equal(second.hash, first.hash)
    assert.equal(readFileSync(join(root, 'model.yaml'), 'utf8'), bytes)
    assert.deepEqual(workspace.readModel().model.nodes.map(node => node.id), ['svc.a', 'svc.b'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a malformed YAML file is a refusal, not a crash', () => {
  const root = mkdtempSync(join(tmpdir(), 'designmap-yaml-bad-'))
  try {
    writeFileSync(join(root, 'model.yaml'), 'nodes: [unclosed\n')
    const workspace = createWorkspace(root)
    assert.throws(() => workspace.readModel(), error => error.code === 'invalid_model' && /not valid YAML/u.test(error.message))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
