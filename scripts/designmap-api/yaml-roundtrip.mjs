/**
 * API test: yaml 2.9.1 parse -> zod validate -> stringify for the designmap model
 * document, including multiline labels, and whether the output is stable enough for
 * byte-identical commits.
 *
 * The model shape exercised here is the one the v1 spec describes (schemaVersion, nodes
 * with id/type/label/source, edges with id/from/to/kind/label, views) as summarised in
 * docs/analysis/designmap-redesign.json and docs/designmap/SCENE-CONTRACT.md.
 *
 * Usage: node yaml-roundtrip.mjs
 * Exit code 0 only when a second round-trip is byte-identical and the semantic model
 * survives unchanged.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import YAML from 'yaml'
import * as z from 'zod'
import { installedVersion } from './version.mjs'

const version = installedVersion('yaml')
const sha256 = text => createHash('sha256').update(text).digest('hex')

/** What a human or an agent hands to apply, written the way the spec writes it. */
const authored = `schemaVersion: 1
nodes:
  - id: svc.checkout.api
    type: service
    label: |-
      Checkout API
      accepts orders and reserves stock
    source: src/checkout/api.ts
  - id: db.orders
    type: datastore
    label: Orders DB
    source: src/orders/schema.sql
  - id: queue.payments
    type: queue
    label: Payments queue
    source: null
edges:
  - id: e.api.orders.read
    from: svc.checkout.api
    to: db.orders
    kind: data
    label: SQL / reads
  - id: e.api.payments.publish
    from: svc.checkout.api
    to: queue.payments
    kind: async
    label: order.created
views:
  - id: v.context
    title: Checkout — context
    level: context
    include: [svc.*, db.*, queue.*]
    direction: LR
`

const node = z.strictObject({
  id: z.string().min(1),
  type: z.enum(['frontend', 'service', 'worker', 'datastore', 'queue', 'external']),
  label: z.string().min(1),
  source: z.string().nullable(),
})
const edge = z.strictObject({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.enum(['sync', 'async', 'data']),
  label: z.string().min(1),
})
const view = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  level: z.enum(['context', 'container', 'component', 'flow']),
  include: z.array(z.string()),
  direction: z.enum(['LR', 'TB']),
})
const model = z.strictObject({
  schemaVersion: z.literal(1),
  nodes: z.array(node),
  edges: z.array(edge),
  views: z.array(view),
})

const parsed = YAML.parse(authored, { uniqueKeys: true })
// A `|` block scalar keeps its trailing newline; a label is not a paragraph, so core
// normalizes before validation or the scene would carry "…\n" and the label lint would
// count a phantom line.
const normalised = {
  ...parsed,
  nodes: parsed.nodes.map(item => ({ ...item, label: item.label.replace(/\n+$/u, '') })),
}
const validation = model.safeParse(normalised)

const options = { lineWidth: 0, indent: 2, blockQuote: 'literal', defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' }
const firstPass = YAML.stringify(normalised, options)
const second = YAML.parse(firstPass, { uniqueKeys: true })
const secondPass = YAML.stringify(second, options)
const defaultPass = YAML.stringify(normalised)
const defaultSecondPass = YAML.stringify(YAML.parse(defaultPass))

// A long label proves the default 80-column folding rewrites bytes.
const longLabel = 'Checkout API accepts orders from the storefront and reserves stock in the warehouse before payment is captured'
const longDoc = { schemaVersion: 1, nodes: [{ id: 'svc.checkout.api', type: 'service', label: longLabel, source: null }], edges: [], views: [] }
const longDefault = YAML.stringify(longDoc)
const longPinned = YAML.stringify(longDoc, options)

// `|` (keep) vs `|-` (strip): the same visible label, two different parsed strings.
const keptBlock = YAML.parse('schemaVersion: 1\nnodes:\n  - id: a\n    type: service\n    label: |\n      first line\n      second line\n    source: null\n')
const strippedBlock = YAML.parse('schemaVersion: 1\nnodes:\n  - id: a\n    type: service\n    label: |-\n      first line\n      second line\n    source: null\n')

// Duplicate ids and duplicate map keys are the two ways a YAML model can lie.
let duplicateKeys
try {
  YAML.parse('nodes:\n  - id: a\n  - id: a\nid: x\nid: y\n')
  duplicateKeys = 'parsed without error (unexpected)'
} catch (error) {
  duplicateKeys = `threw: ${String(error?.message ?? error).split('\n')[0]}`
}

console.log(JSON.stringify({
  yaml: version,
  validationOk: validation.success,
  validationIssues: validation.success ? [] : validation.error.issues,
  parseResult: {
    schemaVersion: parsed.schemaVersion,
    nodeCount: parsed.nodes.length,
    edgeCount: parsed.edges.length,
    viewCount: parsed.views.length,
    multilineLabelRaw: JSON.stringify(parsed.nodes[0].label),
    multilineLabelNormalised: JSON.stringify(normalised.nodes[0].label),
    labelLineCount: normalised.nodes[0].label.split('\n').length,
    keptBlockLabelRaw: JSON.stringify(keptBlock.nodes[0].label),
    strippedBlockLabelRaw: JSON.stringify(strippedBlock.nodes[0].label),
    keptBlockKeepsTrailingNewline: keptBlock.nodes[0].label.endsWith('\n'),
  },
  emittedWithPinnedOptions: {
    bytes: Buffer.byteLength(firstPass),
    hash: sha256(firstPass),
    secondRoundTripBytesIdentical: firstPass === secondPass,
    secondHash: sha256(secondPass),
    multilineLabelForm: firstPass.split('\n').find(line => line.includes('label:')) ?? null,
  },
  emittedWithDefaults: {
    bytes: Buffer.byteLength(defaultPass),
    hash: sha256(defaultPass),
    secondRoundTripBytesIdentical: defaultPass === defaultSecondPass,
    longLabelWrapped: longDefault !== longPinned,
    longLabelDefaultLines: longDefault.split('\n').length,
    longLabelPinnedLines: longPinned.split('\n').length,
  },
  authoredToEmittedByteIdentical: authored === firstPass,
  duplicateMapKeys: duplicateKeys,
  pinnedDocument: firstPass,
}, null, 2))

const failures = []
if (!validation.success) failures.push('the authored model did not validate')
if (!(firstPass === secondPass)) failures.push('pinned-option round-trip is not byte-identical')
if (defaultPass !== defaultSecondPass) failures.push('default round-trip is not byte-identical')
if (longDefault === longPinned) failures.push('default lineWidth did not fold the long label (assumption changed)')
if (!firstPass.includes('label: |-')) failures.push('multiline label not emitted as a block scalar')
if (failures.length > 0) {
  console.error(`FAIL: ${failures.join('; ')}`)
  process.exitCode = 1
}
