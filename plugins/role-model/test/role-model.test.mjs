/*
PROOF: a role can own its model route, and a quota failure switches to the fallback instead of
  killing the turn
Behavior: apply() selects the configured primary route at agent/created for a FRESH session of a
  configured preset (no request header, no model/selection seen since load), never overrides a
  session that already sent a request or recorded a selection, and on agent/request-error with a
  quota code selects the configured fallback and returns { kind: 'retry' } exactly once per agent.
Fails when: a resumed or human-selected session is re-routed, a role without a rule is touched, a
  non-quota failure is swallowed, the second quota failure retries again (loop), or the fallback is
  selected for a role that declares none.
Production path: plugins/role-model/role-model.mjs — normalizeConfig, initialRoute,
  fallbackDecision and the two listeners in apply().
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_QUOTA_CODES,
  apply,
  fallbackDecision,
  initialRoute,
  normalizeConfig,
  presetOf,
} from '../role-model.mjs'

const SOURCE = readFileSync(join(process.cwd(), 'plugins/role-model/role-model.mjs'), 'utf8')
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''

/** The pre-fix shape this plugin removes: a hard-coded route with no per-role rule. */
test('negative control expect-pre-fix has no per-role route table', () => {
  if (control !== 'expect-pre-fix') return
  assert.doesNotMatch(SOURCE, /roles\[preset\]/)
})

const ASTRA = { provider: 'openai-codex', model: 'gpt-6.2-astra', reasoningEffort: 'high' }
const FLASH = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' }
/** The rule the profile declares for the architect role. */
const ROLE = { ...ASTRA, fallback: FLASH }

const policy = () => normalizeConfig({ roles: { architect: ROLE } })

function harness(config, { presetFor } = {}) {
  const handlers = new Map()
  const warnings = []
  const ctx = {
    logger: { warn: (text) => warnings.push(text), info() {} },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(handler)
      return () => {}
    },
    get(name) {
      if (name === 'toolFamilies' && typeof presetFor === 'function') return { presetFor }
      return undefined
    },
  }
  ctx.root = ctx
  apply(ctx, config)
  const emit = (event, ...args) => {
    for (const handler of handlers.get(event) ?? []) handler(...args)
  }
  return { ctx, emit, handlers, warnings }
}

function makeAgent({
  preset = 'architect',
  id = 'agent-1',
  header,
  requestHeader,
  current = ASTRA,
} = {}) {
  const selections = []
  let currentRoute = current
  const agent = {
    id,
    session: {
      id: `session-${id}`,
      header: { agentPreset: preset, cwd: process.cwd(), ...header },
      requestHeader: () => requestHeader,
    },
    model: {
      current: () => currentRoute,
      select(route) {
        selections.push(route)
        currentRoute = route
      },
    },
  }
  return { agent, selections }
}

const created = (payload) => ({ agent: payload.agent })
const failed = (payload) => payload

test('a role rule keeps both halves and rejects a half-rule', () => {
  const normalized = normalizeConfig({
    roles: {
      architect: { provider: 'openai-codex', model: 'gpt-6.2-astra', fallback: FLASH },
      broken: { provider: 'openai-codex' },
      ':': { provider: '', model: '' },
    },
  })
  assert.deepEqual(Object.keys(normalized.roles), ['architect'])
  assert.equal(normalized.roles.architect.primary.model, 'gpt-6.2-astra')
  assert.equal(normalized.roles.architect.fallback.model, 'deepseek-flash')
  assert.equal(normalized.droppedRoles, 2)
  assert.deepEqual(normalized.quotaCodes, DEFAULT_QUOTA_CODES)
})

test('a fresh session of a configured role selects the primary route', () => {
  const { emit } = harness({ roles: { architect: ROLE } })
  const { agent, selections } = makeAgent()
  emit('agent/created', created({ agent }))
  assert.deepEqual(selections, [ASTRA])
})

test('a session that already sent a request is not re-routed', () => {
  const { emit } = harness({ roles: { architect: ROLE } })
  const { agent, selections } = makeAgent({ requestHeader: { config: { provider: 'openai-codex', model: 'gpt-6.2-sol' } } })
  emit('agent/created', created({ agent }))
  assert.deepEqual(selections, [], 'a resumed session keeps the route it had')
})

test('a human selection recorded since load wins over the rule', () => {
  const { emit } = harness({ roles: { architect: ROLE } })
  const { agent, selections } = makeAgent()
  emit('session/event', { id: agent.session.id }, { type: 'model/selection', data: { provider: 'kimi-coding', model: 'k3.1-pro' } })
  emit('agent/created', created({ agent }))
  assert.deepEqual(selections, [], 'the human picked a model; the plugin must not undo it')
})

test('a role without a rule keeps the deployment default', () => {
  const { emit } = harness({ roles: { architect: ROLE } })
  const { agent, selections } = makeAgent({ preset: 'backend' })
  emit('agent/created', created({ agent }))
  assert.deepEqual(selections, [])
})

test('the preset in force comes from the policy owner before the creation header', () => {
  const { ctx } = harness({ roles: { architect: ASTRA } }, { presetFor: () => 'architect' })
  const { agent } = makeAgent({ preset: 'backend' })
  assert.equal(presetOf(ctx, agent), 'architect')
})

test('an unknown preset resolves through the header', () => {
  const { ctx } = harness({ roles: { architect: ROLE } })
  const { agent } = makeAgent({ preset: 'architect' })
  assert.equal(presetOf(ctx, agent), 'architect')
  const nothing = { session: { header: {} } }
  assert.equal(presetOf(ctx, nothing), undefined)
})

test('a quota failure switches to the fallback and retries the step once', async () => {
  const h = harness({ roles: { architect: ROLE } })
  const { agent, selections } = makeAgent()
  const listener = h.handlers.get('agent/request-error')[0]
  let nextCalls = 0
  const action = await listener(
    failed({ agent, provider: 'openai-codex', failure: { code: 'QUOTA', message: 'The usage limit has been reached' } }),
    async () => { nextCalls += 1; return undefined },
  )
  assert.deepEqual(action, { kind: 'retry' })
  assert.equal(nextCalls, 0, 'a handled failure does not fall through to the next listener')
  assert.deepEqual(selections, [FLASH])
  assert.ok(h.warnings.some((line) => line.includes('openai-codex') && line.includes('deepseek-flash')), 'the switch is logged once')
})

test('a second quota failure on the switched agent is terminal, so the step cannot loop', async () => {
  const h = harness({ roles: { architect: ROLE } })
  const { agent } = makeAgent()
  const listener = h.handlers.get('agent/request-error')[0]
  const retry = await listener(failed({ agent, provider: 'openai-codex', failure: { code: 'QUOTA' } }), async () => undefined)
  assert.deepEqual(retry, { kind: 'retry' })
  let nextCalls = 0
  const second = await listener(failed({ agent, provider: 'deepseek-official', failure: { code: 'ACCOUNT_QUOTA' } }), async () => { nextCalls += 1; return undefined })
  assert.equal(second, undefined)
  assert.equal(nextCalls, 1, 'the terminal path delegates to the remaining listeners')
})

test('a non-quota failure is handed to the next listener untouched', async () => {
  const h = harness({ roles: { architect: ROLE } })
  const { agent, selections } = makeAgent()
  const listener = h.handlers.get('agent/request-error')[0]
  let nextCalls = 0
  const action = await listener(failed({ agent, provider: 'deepseek-official', failure: { code: 'RATE_LIMIT' } }), async () => { nextCalls += 1; return undefined })
  assert.equal(action, undefined)
  assert.equal(nextCalls, 1)
  assert.deepEqual(selections, [])
})

test('a role without a fallback never switches', () => {
  const h = harness({ roles: { architect: ROLE } })
  const { agent, selections } = makeAgent()
  assert.equal(fallbackDecision(h.ctx, agent, policy(), { code: 'QUOTA' }, false).action, 'switch')
  const onlyPrimary = normalizeConfig({ roles: { architect: { provider: ASTRA.provider, model: ASTRA.model } } })
  assert.equal(fallbackDecision(h.ctx, agent, onlyPrimary, { code: 'QUOTA' }, false).reason, 'no-fallback')
  assert.deepEqual(selections, [])
})

test('the fallback is not selected when the agent already runs on it', () => {
  const h = harness({ roles: { architect: ROLE } })
  const { agent } = makeAgent({ current: FLASH })
  assert.equal(fallbackDecision(h.ctx, agent, policy(), { code: 'QUOTA' }, false).reason, 'already-fallback')
})

test('initialRoute refuses an agent without a session header', () => {
  const { ctx } = harness({ roles: { architect: ROLE } })
  assert.equal(initialRoute(ctx, { model: { select() {} } }, policy()), null)
})

test('the seat committed after creation routes the live agent (the Web UI flow)', () => {
  const live = makeAgent({ preset: 'orchestrator' })
  const handlers = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(handler)
      return () => {}
    },
    get(name) {
      if (name === 'agents') return { get: (id) => (id === live.agent.session.id ? live.agent : undefined) }
      return undefined
    },
  }
  // A root context that carries the session feed; the seat event names the preset, which the
  // plugin must use because the projection may not have folded it yet.
  ctx.root = { on(event, handler) { ctx.on(event, handler) } }
  apply(ctx, { roles: { architect: ROLE } })
  for (const handler of handlers.get('session/event') ?? []) {
    handler({ id: live.agent.session.id }, { type: 'agent-preset/selected', data: { agentPreset: 'architect' } })
  }
  assert.deepEqual(live.selections, [ASTRA], 'the seat selected after creation must route the session')
})

test('a seat committed before the agent exists is replayed at creation', () => {
  const handlers = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(handler)
      return () => {}
    },
    get() { return undefined },
  }
  ctx.root = { on(event, handler) { ctx.on(event, handler) } }
  apply(ctx, { roles: { architect: ROLE } })
  // The seat arrives while no agent exists for the session: `agents.get()` is undefined here.
  for (const handler of handlers.get('session/event') ?? []) {
    handler({ id: 'session-late' }, { type: 'agent-preset/selected', data: { agentPreset: 'architect' } })
  }
  const { agent, selections } = makeAgent({ preset: 'orchestrator', id: 'agent-late' })
  agent.session.id = 'session-late'
  for (const handler of handlers.get('agent/created') ?? []) handler({ agent })
  assert.deepEqual(selections, [ASTRA], 'the remembered seat must route the session that appears later')
})
