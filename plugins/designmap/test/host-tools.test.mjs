/**
 * PROOF:
 * Behavior: the seven tool definitions carry the names the spec pins, and each tool's
 *   parameter schema is closed — a coordinate or colour field on an op is refused by
 *   the TOOL schema with the field named in the violation path, before execute runs
 *   (owner spec §5, INV-NO-GEO; API-TESTS-CORE §4 name/contract facts).
 * Fails when: a tool is renamed, parameters omit additionalProperties:false, x/y/fill
 *   becomes a declared property, or the op schema is a oneOf that loses the field name.
 * Production path: src/tools.mjs TOOL_SPECS/createHostTools -> index.js registration;
 *   validation is @deepseek-ai/dsh-tools validateArgs (same code path as the host).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHostTools } from '../src/tools.mjs'
import { loadDshTools, stubDefineTool } from './host-helpers.mjs'

const tools = createHostTools({ defineTool: stubDefineTool, hostFor: () => ({}) })
const byName = name => tools.find(tool => tool.name === name)

test('the seven tools exist, named per the spec and inside the wire budget', () => {
  assert.deepEqual(tools.map(tool => tool.name), [
    'designmap_apply', 'designmap_render', 'designmap_lint', 'designmap_status',
    'designmap_scan', 'designmap_open', 'designmap_export',
  ])
  for (const tool of tools) {
    assert.match(tool.name, /^[A-Za-z0-9_-]{1,64}$/u)
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length > 20)
    assert.equal(typeof tool.execute, 'function')
    assert.equal(tool.output.schema.type, 'json')
    assert.equal(typeof tool.output.render, 'function')
  }
})

test('the apply op schema has no geometry property and closes its objects', () => {
  const apply = byName('designmap_apply')
  const op = apply.parameters.ops.items
  assert.equal(op.additionalProperties, false)
  assert.equal(op.properties.value.additionalProperties, false)
  for (const forbidden of ['x', 'y', 'fill', 'stroke', 'position', 'width', 'height']) {
    assert.equal(Object.hasOwn(op.properties.value.properties, forbidden), false, `${forbidden} must not be declared`)
    assert.equal(Object.hasOwn(op.properties, forbidden), false)
  }
})

test('the installed validator refuses x/y/fill by name before execute', async t => {
  const dsh = await loadDshTools()
  if (dsh === null) {
    t.skip('@deepseek-ai/dsh-tools is not resolvable on this machine')
    return
  }
  const apply = byName('designmap_apply')
  const violations = dsh.validateArgs(apply.parameters, {
    ops: [{ kind: 'node', action: 'upsert', value: { id: 'svc.a', type: 'service', label: 'A', x: 1, y: 2, fill: '#fff' } }],
  })
  const joined = violations.join('\n')
  for (const field of ['ops[0].value.x', 'ops[0].value.y', 'ops[0].value.fill']) {
    assert.ok(joined.includes(field), `expected a violation naming ${field}; got ${joined}`)
  }
  assert.deepEqual(
    dsh.validateArgs(apply.parameters, { ops: [{ kind: 'node', action: 'upsert', value: { id: 'svc.a', type: 'service', label: 'A' } }] }),
    [],
  )
  assert.deepEqual(
    dsh.validateArgs(apply.parameters, { ops: [{ kind: 'edge', action: 'remove', id: 'e.a.b' }] }),
    [],
  )
  assert.deepEqual(
    dsh.validateArgs(apply.parameters, { ops: [{ kind: 'edge', action: 'upsert', value: { id: 'e', from: 'a', to: 'b', kind: 'sync', label: 'x' } }] }),
    [],
  )
  const openViolations = dsh.validateArgs(byName('designmap_open').parameters, {})
  assert.ok(openViolations.some(message => message.includes('nodeId')))
  assert.deepEqual(dsh.validateArgs(byName('designmap_status').parameters, {}), [])
  assert.deepEqual(dsh.validateArgs(byName('designmap_render').parameters, { viewId: 'v.context' }), [])
})
