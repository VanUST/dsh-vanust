/*
PROOF: the devops role, the one-live-deployment lane and the scope-overlap guard, driven through
  the product modules (REQ-257 is primary; the case also names REQ-256, REQ-258, REQ-259, REQ-260,
  REQ-261, REQ-262 and REQ-263).
Behavior: against the tree in the working directory the driver
  (a) reads profile/cordis.patch.yml and finds the preset-devops row at order 35 whose tool-todo
      row carries the REQUIRED `allowParallelInProgress` config (a missing required config mounts
      nothing and the preset silently disappears from the roster);
  (b) imports plugins/orchestrator/orchestrator.mjs and resolves DEVOPS, DEPLOYMENT and OPS to
      the devops preset, which delegate_task accepts without an explicit `preset`;
  (c) drives delegate_task with a fake taskboard: a live devops row makes a second delegation
      reject with `devops_lane_busy` naming the row, with no task created and no child started;
      taskId attach, a BACKEND delegation and a settled (review) row are unchanged;
  (d) drives the scope-overlap guard through the tool: an active task's path claim refuses a
      second task whose scope names the same file or a containing directory (`scope_overlap`),
      while a review row, a disjoint file, prose (which claims no path) and an attach are allowed;
  (e) asserts the High reasoning default (profile agent-default-model and role-model) and that a
      started child carries agentOptions.reasoningEffort 'high';
  (f) asserts the ROOT_POLICY anchors for the runtime lane and the Development rules block.
Fails when: the preset row, role mapping, lane guard, scope guard, High default or policy anchors
  are missing or wrong; on git HEAD the preset row, role mapping, lane guard, scope guard,
  profile default and policy anchors all fail (HEAD predates the change).
Production path: profile/cordis.patch.yml; plugins/orchestrator/orchestrator.mjs (ROLE_PRESETS,
  presetForRole, ROOT_POLICY, scopeClaim/claimsOverlap/scopeConflict, delegate_task's lane and
  scope refusals, the child agentOptions).
*/

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const CONTROL = String(process.env.CASE_NEGATIVE_CONTROL ?? '')
const SUMMARY = typeof process.env.CASE_SUMMARY === 'string' && process.env.CASE_SUMMARY !== '' ? process.env.CASE_SUMMARY : ''
const CASE = 'devops-lane-and-scope-overlap'

const checks = []
const log = (...parts) => console.log(`[${CASE}]`, ...parts)

/** Run one named check; a throw is a failed check and names what it saw. */
async function expect(area, name, body) {
  try {
    await body()
    checks.push({ area, name, ok: true })
    log('ok  -', `${area}: ${name}`)
  } catch (error) {
    const detail = String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 500)
    checks.push({ area, name, ok: false, detail })
    log('FAIL-', `${area}: ${name} - ${detail}`)
  }
}

const indentOf = (line) => line.match(/^\s*/)[0].length
const trimmed = (line) => line.trim()

/** The preset-devops block of the profile, parsed by indentation (the kit keeps no YAML dependency). */
function readPresetRow(profileText) {
  const lines = profileText.split('\n')
  const start = lines.findIndex((line) => /^\s*- id: preset-devops\s*$/.test(line))
  assert.ok(start >= 0, 'profile/cordis.patch.yml has no "- id: preset-devops" row')
  const base = indentOf(lines[start])
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (trimmed(line).startsWith('#')) continue
    const nextPreset = /^(\s*)- id: preset-[a-z]+\s*$/.exec(line)
    if (nextPreset !== null && indentOf(line) <= base) { end = index; break }
    if (/^(\s*)- insert:/.test(line) && indentOf(line) < base) { end = index; break }
  }
  const block = lines.slice(start, end)
  const configAt = block.findIndex((line) => /^(\s*)config:\s*$/.test(line) && indentOf(line) === base + 2)
  assert.ok(configAt >= 0, 'the preset-devops row has no config block')
  const fields = {}
  for (let index = configAt + 1; index < block.length; index += 1) {
    const line = block[index]
    if (trimmed(line) === '' || trimmed(line).startsWith('#')) continue
    const indent = indentOf(line)
    if (indent <= base + 2) break
    if (indent === base + 4) {
      const field = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(trimmed(line))
      if (field !== null) fields[field[1]] = field[2].trim()
    }
  }
  const pluginsAt = (() => {
    for (let index = configAt + 1; index < block.length; index += 1) {
      if (indentOf(block[index]) <= base + 2) return -1
      if (indentOf(block[index]) === base + 4 && /^plugins:\s*$/.test(trimmed(block[index]))) return index
    }
    return -1
  })()
  assert.ok(pluginsAt >= 0, 'the preset-devops config has a plugins list')
  const rows = []
  let row = null
  for (let index = pluginsAt + 1; index < block.length; index += 1) {
    const line = block[index]
    if (trimmed(line) === '' || trimmed(line).startsWith('#')) continue
    const indent = indentOf(line)
    if (indent <= base + 4) break
    if (indent === base + 6) {
      const head = /^-\s*id:\s*(\S+)\s*$/.exec(trimmed(line))
      row = head === null ? null : { id: head[1], hasConfig: false, config: {} }
      if (row !== null) rows.push(row)
      continue
    }
    if (row === null) continue
    if (indent === base + 8) {
      if (/^config:\s*$/.test(trimmed(line))) row.hasConfig = true
      continue
    }
    if (row.hasConfig && indent === base + 10) {
      const entry = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(trimmed(line))
      if (entry !== null) row.config[entry[1]] = entry[2].trim()
    }
  }
  return { fields, rows }
}

/** The reasoningEffort values under one role in the role-model block, in file order. */
function roleEfforts(lines, roleModelStart, role) {
  const base = indentOf(lines[roleModelStart])
  let end = lines.length
  for (let index = roleModelStart + 1; index < lines.length; index += 1) {
    if (indentOf(lines[index]) <= base && !trimmed(lines[index]).startsWith('#')) { end = index; break }
  }
  const block = lines.slice(roleModelStart, end)
  const at = block.findIndex((line) => new RegExp(`^${role}:\\s*$`).test(trimmed(line)))
  assert.ok(at >= 0, `role-model has no "${role}" block`)
  const roleBase = indentOf(block[at])
  const values = []
  for (let index = at + 1; index < block.length; index += 1) {
    if (trimmed(block[index]) === '' || trimmed(block[index]).startsWith('#')) continue
    if (indentOf(block[index]) <= roleBase) break
    const found = /^reasoningEffort:\s*(\S+)\s*$/.exec(trimmed(block[index]))
    if (found !== null) values.push(found[1])
  }
  return values
}

/**
 * A fake host around the REAL delegate_task: a taskboard whose list() returns the rows a case
 * needs, a subagents service that records the activation instead of spawning, and a root agent.
 */
function harness(rows = [], detail = {}) {
  const calls = { create: [], update: [], get: [], list: 0, activations: [] }
  const full = new Map(Object.entries(detail))
  const rowFor = (id) => full.get(id) ?? rows.find((entry) => entry.id === id)
  const taskboard = {
    create: (cwd, input) => {
      calls.create.push(input)
      return { ok: true, id: `task-new-${calls.create.length}`, revision: 1, title: input.title, role: input.role, preset: input.preset, status: 'open', scope: input.scope ?? [], nonScope: [], acceptance: [] }
    },
    agents: () => [],
    findAgent: () => undefined,
    list: () => { calls.list += 1; return rows },
    get: (cwd, id) => { calls.get.push(id); return rowFor(id) },
    update: (cwd, input) => {
      calls.update.push(input)
      const before = rowFor(input.id) ?? {}
      const scope = Array.isArray(before.scope) ? before.scope : []
      const nonScope = Array.isArray(before.nonScope) ? before.nonScope : []
      const acceptance = Array.isArray(before.acceptance) ? before.acceptance : []
      return { ok: true, task: { ...before, id: input.id, revision: (before.revision ?? 1) + 1, status: input.patch?.status ?? before.status ?? 'active', scope, nonScope, acceptance } }
    },
    note: () => ({ ok: true }),
    registerAgent: () => ({ ok: true }),
    linkChild: (cwd, input) => ({ ok: true, task: { id: input.id } }),
  }
  const services = new Map([['taskboard', taskboard]])
  const handlers = []
  const ctx = {
    logger: { warn() {}, info() {}, error() {} },
    provide() { return () => {} },
    effect(fn) { if (typeof fn === 'function') fn(); return () => {} },
    on(event, handler) { if (event === 'agent/created') handlers.push(handler) },
    get(name) { return services.get(name) },
    systemPrompt: { getSectionOrder: () => undefined, section() {} },
    tools: { register() {}, guard() {} },
    subagents: {
      getProvider: () => ({ capabilities: { agentPreset: true, agentOptions: true } }),
      async startActivation(spec) {
        calls.activations.push(spec)
        return { childId: `child-${calls.activations.length}` }
      },
      async sendMessage() { throw new Error('this case does not reuse a session') },
      interrupt() {},
    },
  }
  const tools = new Map()
  const agent = {
    id: 'chat-devops-proof',
    session: { id: 'session-devops-proof', header: { id: 'chat-devops-proof', cwd: ROOT, agentPreset: 'orchestrator', delegationDepth: 0 } },
    ctx: {
      on() {},
      systemPrompt: { getSectionOrder: () => 100, section() {} },
      tools: { register(definition) { tools.set(definition.name, definition) }, guard() {} },
    },
  }
  return {
    calls,
    agent,
    ctx,
    handlers,
    delegate(args) {
      const tool = tools.get('delegate_task')
      if (tool === undefined) throw new Error('apply() did not register delegate_task on the root agent')
      return tool.execute({ cwd: ROOT, ...args }, { agent, signal: new AbortController().signal })
    },
    register(apply) { apply(ctx, {}) },
  }
}

/** Build a harness whose root agent/created handlers have run and whose tool is registered. */
function readyHarness(product, rows = [], detail = {}) {
  const built = harness(rows, detail)
  built.register(product.apply)
  for (const handler of built.handlers) handler({ agent: built.agent })
  return built
}

const devopsRow = { id: 'task-live', revision: 3, title: 'deploy 1.2.2 to the stand', role: 'DEVOPS', preset: 'devops', status: 'active' }
const devopsFull = { ...devopsRow, chatId: 'chat-devops-proof', scope: [] }

async function main() {
  let product
  try {
    product = await import(pathToFileURL(join(ROOT, 'plugins/orchestrator/orchestrator.mjs')).href)
  } catch (error) {
    checks.push({ area: 'load', name: 'the orchestrator module imports', ok: false, detail: String(error?.message ?? error) })
    log('FAIL- load:', String(error?.message ?? error))
    return
  }

  // ── (a) the preset row and its REQUIRED tool-todo config ────────────────────────────
  await expect('presetRow', 'profile declares preset-devops at order 35 with the required tool-todo config', () => {
    const profile = readFileSync(join(ROOT, 'profile/cordis.patch.yml'), 'utf8')
    const { fields, rows } = readPresetRow(profile)
    assert.equal(fields.id, 'devops', 'the preset row declares id devops')
    assert.equal(fields.order, '35', 'the preset row is declared at order 35')
    const todo = rows.find((entry) => entry.id === 'tool-todo')
    assert.ok(todo !== undefined, 'the devops preset declares a tool-todo row')
    assert.ok(todo.hasConfig, 'the tool-todo row carries a config block (the schema has no default)')
    assert.ok(Object.hasOwn(todo.config, 'allowParallelInProgress'), 'the tool-todo config carries allowParallelInProgress (omitting it fails the preset mount silently)')
    assert.equal(todo.config.allowParallelInProgress, 'false', 'the deployment lane allows one in-progress todo')
  })

  // ── (b) role spellings and the delegation that needs no explicit preset ──────────────
  await expect('roleMapping', 'DEVOPS resolves to preset devops', () => {
    assert.equal(product.presetForRole('DEVOPS'), 'devops')
  })
  await expect('roleMapping', 'DEPLOYMENT resolves to preset devops', () => {
    assert.equal(product.presetForRole('DEPLOYMENT'), 'devops')
  })
  await expect('roleMapping', 'OPS resolves to preset devops', () => {
    assert.equal(product.presetForRole('OPS'), 'devops')
  })
  await expect('roleMapping', 'PRESET_IDS includes devops', () => {
    assert.ok(Array.isArray(product.PRESET_IDS))
    assert.ok(product.PRESET_IDS.includes('devops'), 'PRESET_IDS lists devops')
  })
  await expect('roleMapping', 'delegate_task accepts role DEVOPS without an explicit preset', async () => {
    const built = readyHarness(product)
    const result = await built.delegate({ title: 'deploy 1.2.3 to the stand', role: 'DEVOPS', objective: 'replace the running deployment with 1.2.3 and prove the version from outside' })
    assert.notEqual(result?.ok, false)
    assert.equal(built.calls.create.length, 1, 'the delegation created one task row')
    assert.equal(built.calls.create[0].preset, 'devops', 'the created task was composed as devops')
    assert.equal(built.calls.activations.length, 1, 'the delegation started one child')
    assert.equal(built.calls.activations[0].request.agentPreset, 'devops', 'the child was started on the devops preset')
  })

  // ── (c) the one-live-deployment lane ────────────────────────────────────────────────
  await expect('laneGuard', 'a second live DEVOPS task is refused with devops_lane_busy naming the task', async () => {
    const built = readyHarness(product, [devopsRow], { 'task-live': devopsFull })
    let refusal
    try {
      await built.delegate({ title: 'roll 1.2.2 back', role: 'DEPLOY', objective: 'return the stand to the previous version' })
    } catch (error) {
      refusal = error
    }
    assert.ok(refusal !== undefined, 'delegate_task rejected the second live deployment')
    assert.match(String(refusal.message), /devops_lane_busy/, 'the refusal names the lane rule')
    assert.match(String(refusal.message), /task-live/, 'the refusal names the task that holds the lane')
    assert.match(String(refusal.message), /active/, 'the refusal names the holder status')
    assert.equal(built.calls.create.length, 0, 'a refused lane creates no task row')
    assert.equal(built.calls.activations.length, 0, 'a refused lane starts no child')
  })
  await expect('laneGuard', 'attaching to the live deployment task is allowed', async () => {
    const built = readyHarness(product, [devopsRow], { 'task-live': devopsFull })
    const result = await built.delegate({ title: 'finish the deployment', role: 'DEVOPS', taskId: 'task-live', objective: 'verify the version the live stand reports' })
    assert.notEqual(result?.ok, false)
    assert.equal(result.taskId, 'task-live', 'the brief attached to the same row')
    assert.equal(built.calls.create.length, 0, 'an attach creates no second row')
    assert.equal(built.calls.activations.length, 1, 'the attach starts one child')
  })
  await expect('laneGuard', 'a BACKEND delegation is unaffected by the live devops task', async () => {
    const built = readyHarness(product, [devopsRow], { 'task-live': devopsFull })
    const result = await built.delegate({ title: 'fix the deployment timeout', role: 'BACKEND', objective: 'change the client timeout and prove it with the product' })
    assert.notEqual(result?.ok, false)
    assert.equal(built.calls.create.length, 1)
    assert.equal(built.calls.create[0].preset, 'backend')
    assert.equal(built.calls.activations.length, 1)
  })

  // ── (d) the scope-overlap guard, through the tool and through its exported rule ──────
  const holderRow = { id: 'task-hold', revision: 2, title: 'harden the orchestrator guard', role: 'BACKEND', preset: 'backend', status: 'active' }
  const holderFull = { ...holderRow, chatId: 'chat-devops-proof', scope: ['plugins/orchestrator/orchestrator.mjs: change the guard'] }
  await expect('scopeGuard', 'an active task claiming the file refuses a second task (scope_overlap, no row, no child)', async () => {
    const built = readyHarness(product, [holderRow], { 'task-hold': holderFull })
    let refusal
    try {
      await built.delegate({ title: 'edit the same guard', role: 'BACKEND', objective: 'adjust the guard again', scope: ['plugins/orchestrator/orchestrator.mjs: refresh the guard'] })
    } catch (error) {
      refusal = error
    }
    assert.ok(refusal !== undefined, 'delegate_task rejected the colliding scope')
    assert.match(String(refusal.message), /scope_overlap/, 'the refusal names the scope rule')
    assert.match(String(refusal.message), /task-hold/, 'the refusal names the task that holds the file')
    assert.equal(built.calls.create.length, 0, 'a refused scope creates no task row')
    assert.equal(built.calls.activations.length, 0, 'a refused scope starts no child')
  })
  await expect('scopeGuard', 'a directory claim contains the file claim and is refused', async () => {
    const dirFull = { ...holderRow, id: 'task-dir', chatId: 'chat-devops-proof', scope: ['plugins/orchestrator/: the whole seat'] }
    const dirRow = { ...holderRow, id: 'task-dir' }
    const built = readyHarness(product, [dirRow], { 'task-dir': dirFull })
    let refusal
    try {
      await built.delegate({ title: 'touch a file in the claimed directory', role: 'BACKEND', objective: 'edit one file', scope: ['plugins/orchestrator/orchestrator.mjs'] })
    } catch (error) {
      refusal = error
    }
    assert.ok(refusal !== undefined, 'a directory claim refused the contained file')
    assert.match(String(refusal.message), /scope_overlap/)
    assert.equal(built.calls.create.length, 0)
    assert.equal(built.calls.activations.length, 0)
  })
  await expect('scopeGuard', 'a review row does not hold the file', async () => {
    const reviewFull = { ...holderFull, id: 'task-review', status: 'review' }
    const reviewRow = { ...holderRow, id: 'task-review', status: 'review' }
    const built = readyHarness(product, [reviewRow], { 'task-review': reviewFull })
    const result = await built.delegate({ title: 'continue after review', role: 'BACKEND', objective: 'edit the guard once it is settled', scope: ['plugins/orchestrator/orchestrator.mjs'] })
    assert.notEqual(result?.ok, false)
    assert.equal(built.calls.create.length, 1)
    assert.equal(built.calls.activations.length, 1)
  })
  await expect('scopeGuard', 'a disjoint file is allowed', async () => {
    const otherFull = { ...holderRow, id: 'task-other', chatId: 'chat-devops-proof', scope: ['profile/cordis.patch.yml: the preset row'] }
    const otherRow = { ...holderRow, id: 'task-other' }
    const built = readyHarness(product, [otherRow], { 'task-other': otherFull })
    const result = await built.delegate({ title: 'edit another file', role: 'BACKEND', objective: 'edit the orchestrator', scope: ['plugins/orchestrator/orchestrator.mjs'] })
    assert.notEqual(result?.ok, false)
    assert.equal(built.calls.create.length, 1)
    assert.equal(built.calls.activations.length, 1)
  })
  await expect('scopeGuard', 'prose that names no path claims nothing', async () => {
    const otherFull = { ...holderRow, id: 'task-prose', chatId: 'chat-devops-proof', scope: ['profile/cordis.patch.yml: the preset row'] }
    const proseRow = { ...holderRow, id: 'task-prose' }
    const built = readyHarness(product, [proseRow], { 'task-prose': otherFull })
    const result = await built.delegate({ title: 'read the product modules', role: 'BACKEND', objective: 'read and report', scope: ['read the product modules'] })
    assert.notEqual(result?.ok, false)
    assert.equal(built.calls.create.length, 1)
  })
  await expect('scopeGuard', 'attaching to the holding task is allowed', async () => {
    const built = readyHarness(product, [holderRow], { 'task-hold': holderFull })
    const result = await built.delegate({ title: 'continue the held task', role: 'BACKEND', taskId: 'task-hold', objective: 'finish the guard', scope: ['plugins/orchestrator/orchestrator.mjs'] })
    assert.notEqual(result?.ok, false)
    assert.equal(result.taskId, 'task-hold')
    assert.equal(built.calls.create.length, 0)
    assert.equal(built.calls.activations.length, 1)
  })
  await expect('scopeGuard', 'the exported claim helpers normalize one spelling of a path', () => {
    const scopeClaim = product.scopeClaim
    const claimsOverlap = product.claimsOverlap
    assert.equal(typeof scopeClaim, 'function', 'scopeClaim is exported')
    assert.equal(typeof claimsOverlap, 'function', 'claimsOverlap is exported')
    assert.equal(scopeClaim('plugins/orchestrator/orchestrator.mjs: change the guard'), 'plugins/orchestrator/orchestrator.mjs', 'the leading path token is the claim')
    assert.equal(scopeClaim('plugins/orchestrator/: the whole seat'), 'plugins/orchestrator', 'a trailing slash is dropped')
    assert.equal(scopeClaim('./profile/cordis.patch.yml'), 'profile/cordis.patch.yml', 'a leading ./ is dropped')
    assert.equal(scopeClaim('docs/cases/../cases/x.json'), 'docs/cases/x.json', '.. is resolved lexically')
    assert.equal(scopeClaim('plugins\\orchestrator\\orchestrator.mjs'), '', 'a backslash entry claims nothing: the kit forbids backslash path splitting (scripts/check-portability.mjs no-backslash-path-splitting)')
    assert.equal(scopeClaim('read the product modules'), '', 'prose claims no path')
    assert.equal(claimsOverlap('plugins/orchestrator', 'plugins/orchestrator/orchestrator.mjs'), true, 'a directory contains a file')
    assert.equal(claimsOverlap('plugins/orchestrator/orchestrator.mjs', 'plugins/orchestrator/orchestrator.mjs.bak'), false, 'a sibling name is not the same file')
  })

  // ── (e) the High reasoning default and the started child ────────────────────────────
  await expect('configEffort', 'the profile default model and the role routes say High, and no max-effort default remains', () => {
    const profile = readFileSync(join(ROOT, 'profile/cordis.patch.yml'), 'utf8')
    const lines = profile.split('\n')
    const defaultAt = lines.findIndex((line) => /^\s*- id: agent-default-model\s*$/.test(line))
    assert.ok(defaultAt >= 0, 'the profile declares agent-default-model')
    const defaultBase = indentOf(lines[defaultAt])
    let defaultEffort
    for (let index = defaultAt + 1; index < lines.length; index += 1) {
      if (trimmed(lines[index]) === '' || trimmed(lines[index]).startsWith('#')) continue
      if (indentOf(lines[index]) <= defaultBase) break
      const found = /^reasoningEffort:\s*(\S+)\s*$/.exec(trimmed(lines[index]))
      if (found !== null) { defaultEffort = found[1]; break }
    }
    assert.equal(defaultEffort, 'high', 'agent-default-model runs at High effort')
    const roleModelAt = lines.findIndex((line) => /^\s*- id: role-model\s*$/.test(line))
    assert.ok(roleModelAt >= 0, 'the profile declares role-model')
    const architect = roleEfforts(lines, roleModelAt, 'architect')
    assert.ok(architect.length >= 2, 'the architect names a primary and a fallback effort')
    for (const value of architect) assert.equal(value, 'high', 'the architect (primary and fallback) runs at High effort')
    const devops = roleEfforts(lines, roleModelAt, 'devops')
    assert.ok(devops.length >= 1, 'role-model names the devops route')
    for (const value of devops) assert.equal(value, 'high', 'the devops role runs at High effort')
    assert.ok(!/^\s*reasoningEffort:\s*max\s*$/m.test(profile), 'the kit profile carries no max-effort default')
  })
  await expect('childEffort', 'a started child carries agentOptions.reasoningEffort high', async () => {
    const built = readyHarness(product)
    const result = await built.delegate({ title: 'prove a backend change', role: 'BACKEND', objective: 'change the client and prove it with the product' })
    assert.notEqual(result?.ok, false)
    const spec = built.calls.activations[0]
    assert.ok(spec !== undefined, 'the delegated child was started')
    assert.equal(spec?.agentOptions?.reasoningEffort, 'high', 'the child activation carries the High effort in agentOptions')
    assert.equal(spec?.request?.agentOptions?.reasoningEffort, 'high', 'the legacy request block carries the same option')
  })

  // ── (f) the root policy anchors ────────────────────────────────────────────────────
  await expect('rootPolicy', 'ROOT_POLICY carries the runtime-lane rule', () => {
    const policy = String(product.ROOT_POLICY ?? '')
    assert.ok(policy.length > 0, 'ROOT_POLICY is exported and not empty')
    assert.ok(policy.includes('RUNNING DEPLOYMENT'), 'the shared runtime is named beside the other serialising resources')
    assert.ok(policy.includes('DEVOPS owns it'), 'DEVOPS owns the deployment lane')
    assert.ok(policy.includes('one live deployment task per chat'), 'the one-live-task rule is stated')
    assert.ok(policy.includes('devops_lane_busy'), 'the refusal is named in the policy')
    assert.ok(policy.includes('runningChildSessionIds'), 'the root reads the board for running children before a restart')
  })
  await expect('rootPolicy', 'ROOT_POLICY carries the Development rules block', () => {
    const policy = String(product.ROOT_POLICY ?? '')
    assert.ok(policy.includes('Development rules'), 'the block is titled')
    assert.ok(policy.includes('A rule lives in ONE place'), 'one owner per rule')
    assert.ok(policy.includes('A tool that exists is not a behaviour that changed'), 'a tool is not a behaviour until observed')
    assert.ok(policy.includes('Prove by running, not by reading'), 'proof by running')
    assert.ok(policy.includes('The smallest complete change'), 'the smallest complete change')
    assert.ok(policy.includes('Say what you skipped'), 'what was skipped is said')
  })

  // ── the driver's own negative control: it must break when asked to expect the old tree ──
  if (CONTROL === 'expect-pre-fix') {
    await expect('control', 'negative control expect-pre-fix (this check must fail on the fixed tree)', () => {
      assert.equal(product.presetForRole('DEVOPS'), undefined, 'the pre-fix tree has no DEVOPS role mapping')
    })
  }
}

const areas = ['presetRow', 'roleMapping', 'laneGuard', 'scopeGuard', 'configEffort', 'childEffort', 'rootPolicy', 'control', 'load']
function areaOk(area) {
  const rows = checks.filter((entry) => entry.area === area)
  return rows.length > 0 && rows.every((entry) => entry.ok) ? 1 : 0
}

function writeSummary() {
  const failures = checks.filter((entry) => !entry.ok)
  const metrics = { failures: failures.length, checks: checks.length }
  for (const area of areas) metrics[area] = areaOk(area)
  const payload = {
    metrics,
    checks: checks.map((entry) => ({ area: entry.area, name: entry.name, ok: entry.ok, ...(entry.detail === undefined ? {} : { detail: entry.detail }) })),
    notes: failures.length === 0 ? `${checks.length} checks passed` : failures.map((entry) => `${entry.area}: ${entry.name} - ${entry.detail}`).join(' | ').slice(0, 1800),
    artifacts: [],
  }
  if (SUMMARY !== '') {
    try { writeFileSync(SUMMARY, `${JSON.stringify(payload, null, 2)}\n`, 'utf8') } catch (error) { console.error('could not write CASE_SUMMARY:', error?.message ?? error) }
  }
  console.log(`CASE_SUMMARY ${JSON.stringify({ case: CASE, checks: failures.length === 0 ? 'pass' : 'fail', failures: failures.length, metrics })}`)
  if (failures.length > 0) {
    console.error(`\n${CASE} FAILED (${failures.length}):\n- ${failures.map((entry) => `${entry.area}: ${entry.name} - ${entry.detail}`).join('\n- ')}`)
    process.exitCode = 1
  }
}

try {
  await main()
} catch (error) {
  checks.push({ area: 'load', name: 'the driver ran to completion', ok: false, detail: String(error?.message ?? error) })
  console.error(`\n${CASE} FAILED with an exception: ${error?.stack ?? error}`)
}
writeSummary()
