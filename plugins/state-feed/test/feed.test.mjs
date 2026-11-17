/*
PROOF: state-feed delivery contract
Behavior: a root session receives L1 exactly once as a model-visible message containing the
  digest (and the plan/snapshot when present); a workspace without state/views/digest.md gets
  nothing; a delegated worker gets nothing; at a turn boundary one aggregated L2 delta is
  injected only when the projection hash changed, capped at 1200 bytes, and never twice in the
  same turn even when the state changes more than once.
Fails when: L1 repeats, a worker or a stateless workspace receives an injection, L2 fires on an
  unchanged hash, or a second change inside one turn produces a second delta.
Production path: plugins/state-feed/index.mjs (apply) with lib/feed.mjs; the injected message is
  written by the harness as user/message, so it satisfies "model-visible means logged".
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStateService } from '../../project-state/lib/core.mjs'
import { L1_HEADER, L2_HEADER, L2_LIMIT_BYTES, composeL1, composeL2, readState } from '../lib/feed.mjs'
import { apply, isRootAgent } from '../index.mjs'

const clock = () => '2026-01-03T00:00:00.000Z'

/** A fake host: collects handlers and every injected message. */
function host() {
  const handlers = { 'agent/created': [], 'agent/pre-step': [] }
  const ctx = {
    on(event, handler) {
      if (handlers[event] !== undefined) handlers[event].push(handler)
    },
    logger: { warn() {} },
    root: null,
  }
  ctx.root = ctx
  return { ctx, handlers }
}

const created = async (env, agent) => {
  for (const handler of env.handlers['agent/created']) await handler({ agent })
}
const preStep = async (env, agent, turn, step) => {
  for (const handler of env.handlers['agent/pre-step']) await handler({ agent, turn, step }, async () => ({ ok: true }))
}

function agentOf(cwd, { id = 'root-1', depth = 0, parent } = {}) {
  const injected = []
  const agent = {
    session: { id, header: { cwd, delegationDepth: depth, ...(parent === undefined ? {} : { parentSession: parent }) } },
    inject(message) {
      injected.push(message)
    },
  }
  return { agent, injected }
}

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), 'state-feed-'))
  const state = createStateService({ cwd, now: clock })
  const req = await state.create('req', { title: 'State feed', criteria: ['L1 once', 'L2 by hash'] })
  const task = await state.create('task', { title: 'Deliver the digest', reqId: req.id })
  await state.regenerateViews()
  await writeFile(join(cwd, 'state', 'plan.yaml'), 'name: probe\nphase: delivery\n')
  return { cwd, state, req, task }
}

test('root receives L1 once, with the digest and the plan', async () => {
  const { cwd } = await workspace()
  const env = host()
  apply(env.ctx)
  const { agent, injected } = agentOf(cwd)
  await created(env, agent)
  assert.equal(injected.length, 1)
  const text = injected[0].content[0].text
  assert.ok(text.startsWith(L1_HEADER))
  assert.match(text, /REQ 1 · TASK 1/)
  assert.match(text, /## Plan/)
  assert.match(text, /name: probe/)
  assert.equal(injected[0].source.kind, 'state-feed')
  await preStep(env, agent, 2, 1)
  assert.equal(injected.length, 1, 'L1 is never repeated')
})

test('no state/views/digest.md means no injection at all', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'state-feed-empty-'))
  const env = host()
  apply(env.ctx)
  const { agent, injected } = agentOf(cwd)
  await created(env, agent)
  await preStep(env, agent, 2, 1)
  assert.equal(injected.length, 0)
})

test('a delegated worker receives neither L1 nor L2', async () => {
  const { cwd } = await workspace()
  const env = host()
  apply(env.ctx)
  const { agent, injected } = agentOf(cwd, { depth: 1 })
  await created(env, agent)
  await preStep(env, agent, 2, 1)
  assert.equal(injected.length, 0)
  assert.equal(isRootAgent(agent), false)
})

test('L2 fires once on a changed hash and not again in the same turn', async () => {
  const { cwd, state, req } = await workspace()
  const env = host()
  apply(env.ctx)
  const { agent, injected } = agentOf(cwd)
  await created(env, agent)
  assert.equal(injected.length, 1)
  // Unchanged state: a turn boundary injects nothing.
  await preStep(env, agent, 2, 1)
  assert.equal(injected.length, 1)
  // A real change between turns: one delta, capped.
  await state.create('task', { title: 'Second task', reqId: req.id })
  await state.regenerateViews()
  await preStep(env, agent, 3, 1)
  assert.equal(injected.length, 2)
  const delta = injected[1].content[0].text
  assert.ok(delta.startsWith(L2_HEADER))
  assert.ok(Buffer.byteLength(delta, 'utf8') <= L2_LIMIT_BYTES)
  // Two more changes inside turn 3 still produce no second delta for that turn.
  await state.create('task', { title: 'Third task', reqId: req.id })
  await state.regenerateViews()
  await preStep(env, agent, 3, 1)
  await preStep(env, agent, 3, 2)
  assert.equal(injected.length, 2, 'one delta per turn')
  // The next turn sees the newest hash.
  await preStep(env, agent, 4, 1)
  assert.equal(injected.length, 3)
})

test('composeL2 aggregates several changes into one bounded delta', async () => {
  const { cwd, state, req } = await workspace()
  const before = readState(cwd)
  await state.create('task', { title: 'A', reqId: req.id })
  await state.create('task', { title: 'B', reqId: req.id })
  await state.regenerateViews()
  const after = readState(cwd)
  const delta = composeL2(after, before.hash)
  assert.ok(delta.includes(L2_HEADER))
  assert.ok(Buffer.byteLength(delta, 'utf8') <= L2_LIMIT_BYTES)
  assert.match(delta, /- TASK: 3/)
  assert.equal(delta.includes('\n- TASK: 1\n'), false)
})

test('composeL1 keeps the digest, the plan and the snapshot in a fixed order', async () => {
  const { cwd } = await workspace()
  const state = readState(cwd)
  const text = composeL1(state)
  const digestAt = text.indexOf(state.digest.trim())
  const planAt = text.indexOf('## Plan')
  const snapshotAt = text.indexOf('## Last snapshot')
  assert.ok(digestAt >= 0 && planAt > digestAt && snapshotAt > planAt)
})
