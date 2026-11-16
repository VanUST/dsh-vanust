/**
 * PROOF:
 * Behavior: the `/designmap <json>` command is the panel's write path — status, render,
 *   apply, lint, open, export and overlay return `{kind:'success', text:<JSON>}`, a
 *   refusal is a `{kind:'error', text:'designmap: <code>: …'}` value the panel can
 *   quote, and bad input never throws out of the handler (M1/M2 transport,
 *   API-TESTS-CORE §4). The overlay op forwards only its visual fields: the transport
 *   key `op` and any model field stop at the command boundary, while the host guard
 *   still refuses a model field passed directly to the domain call.
 * Fails when: the command throws instead of returning an error value, loses the JSON
 *   result shape, accepts an unknown op silently, forwards `op`/model fields into
 *   `service.overlay`, or the host guard stops being able to fail.
 * Production path: src/command.mjs createCommandHandler -> src/host.mjs service;
 *   registered by index.js on ctx.commands.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCommandHandler } from '../src/command.mjs'
import { createHostService, createFileLogger } from '../src/host.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRepo } from './host-helpers.mjs'

function harness(repo) {
  const hostFor = () => {
    const { logger, path } = createFileLogger(repo.designmapDir)
    return { service: createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root, logger }), logger, logPath: path }
  }
  return { handler: createCommandHandler({ hostFor }), invocation: rawInput => ({ agent: { session: { header: { cwd: repo.root } } }, rawInput }) }
}

test('status, apply, render, lint, open and export answer over the command path', async () => {
  const repo = makeRepo()
  try {
    const { handler, invocation } = harness(repo)
    const status = await handler(invocation(JSON.stringify({ op: 'status' })))
    assert.equal(status.kind, 'success')
    assert.equal(JSON.parse(status.text).missingManifest, true)

    const applied = await handler(invocation(JSON.stringify({ op: 'apply', ops: [] })))
    assert.equal(applied.kind, 'success')
    assert.equal(JSON.parse(applied.text).ok, true)

    const render = await handler(invocation(JSON.stringify({ op: 'render', viewId: 'v.context' })))
    assert.equal(render.kind, 'success')
    const envelope = JSON.parse(render.text)
    assert.equal(envelope.viewId, 'v.context')
    assert.match(envelope.sceneHash, /^sha256:/u)

    const lint = await handler(invocation(JSON.stringify({ op: 'lint' })))
    assert.equal(lint.kind, 'success')
    assert.equal(JSON.parse(lint.text).views[0].lint.ok, true)

    const open = await handler(invocation(JSON.stringify({ op: 'open', nodeId: 'svc.checkout.api' })))
    assert.equal(open.kind, 'success')
    assert.equal(JSON.parse(open.text).source, 'src/checkout/api.ts')

    const exported = await handler(invocation(JSON.stringify({ op: 'export', viewId: 'v.context' })))
    assert.equal(exported.kind, 'success')
    assert.equal(JSON.parse(exported.text).svgPath, 'designmap/out/v.context.svg')
  } finally {
    repo.cleanup()
  }
})

test('the overlay op forwards only visual fields; the domain guard still refuses model fields', async () => {
  const repo = makeRepo()
  try {
    const { handler, invocation } = harness(repo)
    // A panel payload that also carries a model field: the transport key `op` and
    // `type` must not reach service.overlay, and the stored row must be visual only.
    const result = await handler(invocation(JSON.stringify({
      op: 'overlay',
      action: 'upsert',
      nodeId: 'db.orders',
      x: 12,
      y: 34,
      type: 'service',
    })))
    assert.equal(result.kind, 'success', result.text)
    const stored = JSON.parse(readFileSync(join(repo.designmapDir, 'overlays.json'), 'utf8'))
    assert.deepEqual(stored['db.orders'], { x: 12, y: 34 })
    assert.equal('type' in stored['db.orders'], false)
    assert.equal('op' in stored, false)

    // Defense in depth stays capable of failing at the domain boundary.
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    assert.throws(
      () => service.overlay({ action: 'upsert', nodeId: 'db.orders', type: 'service' }),
      error => error.code === 'model_fields_forbidden' && /type/u.test(error.message),
    )
    assert.throws(
      () => service.overlay({ action: 'replace', nodeId: 'db.orders', row: { x: 1, y: 2, label: 'evil' } }),
      error => error.code === 'model_fields_forbidden' && /label/u.test(error.message),
    )
  } finally {
    repo.cleanup()
  }
})

test('refusals and bad input are error values, never thrown errors', async () => {
  const repo = makeRepo()
  try {
    const { handler, invocation } = harness(repo)
    const badJson = await handler(invocation('not json'))
    assert.deepEqual(badJson, { kind: 'error', text: 'designmap: expected a JSON operation' })
    const unknown = await handler(invocation(JSON.stringify({ op: 'explode' })))
    assert.equal(unknown.kind, 'error')
    assert.match(unknown.text, /unknown op/u)

    const geometry = await handler(invocation(JSON.stringify({
      op: 'apply',
      ops: [{ kind: 'node', action: 'upsert', value: { id: 'svc.x', type: 'service', label: 'X', x: 1 } }],
    })))
    assert.equal(geometry.kind, 'error')
    assert.match(geometry.text, /^designmap: invalid_ops: /u)

    const unknownNode = await handler(invocation(JSON.stringify({ op: 'open', nodeId: 'nope' })))
    assert.equal(unknownNode.kind, 'error')
    assert.match(unknownNode.text, /^designmap: unknown_node: /u)
  } finally {
    repo.cleanup()
  }
})

