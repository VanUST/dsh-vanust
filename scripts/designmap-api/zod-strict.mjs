/**
 * API test: zod 4.6.7 strict-object behaviour, as designmap_core's model schema needs it.
 *
 * The requirement that decides the schema style is INV-NO-GEO / FR-2: an agent op that
 * carries coordinates or colours must be REJECTED by the schema with the offending path,
 * not silently stripped. A default z.object strips unknown keys, which would let a
 * coordinate through unnoticed, so this test compares the three available spellings.
 *
 * Usage: node zod-strict.mjs
 * Exit code 0 only when the strict spelling rejects with the expected path.
 */
import { readFileSync } from 'node:fs'
import * as z from 'zod'
import { installedVersion } from './version.mjs'

const version = installedVersion('zod')

const node = z.strictObject({
  id: z.string().min(1),
  type: z.enum(['frontend', 'service', 'worker', 'datastore', 'queue', 'external']),
  label: z.string().min(1),
  source: z.string().nullable().optional(),
})
const edge = z.strictObject({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.enum(['sync', 'async', 'data']),
  label: z.string().min(1),
})
const applyOp = z.strictObject({
  op: z.enum(['upsert', 'remove']),
  nodes: z.array(node).default([]),
  edges: z.array(edge).default([]),
})

/** The op an agent must not be able to send: semantic fields plus geometry. */
const dirtyOp = {
  op: 'upsert',
  nodes: [
    { id: 'svc.checkout.api', type: 'service', label: 'Checkout API', source: 'src/checkout/api.ts' },
    { id: 'db.orders', type: 'datastore', label: 'Orders DB', source: null, x: 420, y: 180, fill: '#2563eb' },
  ],
}

const strictResult = applyOp.safeParse(dirtyOp)
const cleanResult = applyOp.safeParse({
  op: 'upsert',
  nodes: [{ id: 'svc.checkout.api', type: 'service', label: 'Checkout API', source: 'src/checkout/api.ts' }],
})

// Same shape as a plain z.object: the default strips unknown keys instead of refusing.
const plain = z.object({
  id: z.string(),
  type: z.enum(['frontend', 'service', 'worker', 'datastore', 'queue', 'external']),
  label: z.string(),
  source: z.string().nullable().optional(),
})
const plainResult = plain.safeParse(dirtyOp.nodes[1])

// `.strict()` on a plain object: does the deprecated spelling still exist and work?
let dotStrict = { available: typeof (z.object({}).strict) === 'function' }
if (dotStrict.available) {
  try {
    const parsed = z.object({ id: z.string() }).strict().safeParse({ id: 'a', x: 1 })
    dotStrict.behaviour = { success: parsed.success, issues: parsed.success ? [] : parsed.error.issues.map(issue => ({ code: issue.code, path: issue.path, keys: issue.keys })) }
  } catch (error) {
    dotStrict.behaviour = { threw: String(error?.message ?? error) }
  }
}

const issueShape = strictResult.success ? null : strictResult.error.issues.map(issue => ({
  code: issue.code,
  path: issue.path,
  message: issue.message,
  keys: issue.keys,
  pathLength: issue.path.length,
  pathTypes: issue.path.map(segment => (typeof segment === 'number' ? 'number' : 'string')),
}))

console.log(JSON.stringify({
  zod: version,
  api: {
    strictObject: typeof z.strictObject,
    plainObjectStrictMethod: typeof z.object({}).strict,
    plainObjectPassthroughMethod: typeof z.object({}).passthrough,
    flatMapTopLevelError: typeof z.flattenError,
    treeifyError: typeof z.treeifyError,
  },
  dotStrict,
  strictRejectsGeometry: !strictResult.success,
  cleanOpAccepted: cleanResult.success,
  issues: issueShape,
  plainObjectSilentlyStrips: plainResult.success
    ? { success: true, parsedKeys: Object.keys(plainResult.data), droppedCoordinates: !('x' in plainResult.data) }
    : { success: false },
}, null, 2))

const issues = issueShape ?? []
const geometryIssue = issues.find(issue => issue.code === 'unrecognized_keys')
const expectations = [
  [typeof z.strictObject === 'function', 'z.strictObject is not a function'],
  [!strictResult.success, 'strict op accepted an op carrying x/y/fill'],
  [cleanResult.success, 'strict op rejected a clean semantic op'],
  [geometryIssue !== undefined, 'no unrecognized_keys issue reported'],
  [JSON.stringify(geometryIssue?.path) === '["nodes",1]', `unexpected path: ${JSON.stringify(geometryIssue?.path)}`],
  [JSON.stringify(geometryIssue?.keys) === '["x","y","fill"]', `unexpected keys: ${JSON.stringify(geometryIssue?.keys)}`],
  [plainResult.success === true, 'default z.object did not silently strip (test assumption changed)'],
]
const failures = expectations.filter(([ok, message]) => !ok).map(([, message]) => message)
if (failures.length > 0) {
  console.error(`FAIL: ${failures.join('; ')}`)
  process.exitCode = 1
}
