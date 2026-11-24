#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove the preset→tool-family policy before it touches a server: run the real decision
 *   function from `plugins/tool-families/tool-families.mjs` over a real tool list, for every
 *   preset, in both workspace kinds (a plain repository and a Godot checkout), and assert the
 *   contract the deployment agreed on:
 *
 *     allow list  → a preset with `allow` keeps ONLY names matching it (V1.1)
 *     Playwright  → standard, ux only
 *     Godot       → standard only; no kit row allows it (an unlisted host family is gone)
 *     hindsight   → orchestrator (read half); removed from every worker row
 *     a preset without a row (standard, cordis, ptc, unknown) keeps its full surface
 *
 * WHY IT EXISTS. The policy is a config table, and a config table that is wrong fails silently:
 * the tools simply stay in the header and every step pays for them, or a role silently loses a
 * capability it needs. This script is also meant to go red against the previous plugin bytes
 * (see INPUTS), so it is a check and not a restatement.
 *
 * INPUTS
 *   --plugin <path>     module under test (default plugins/tool-families/tool-families.mjs)
 *   --from-session <d>  read the real tool names from a session directory's request/header
 *                       (`<dir>/session.v4.jsonl.zstd`); default: a synthetic list shaped like
 *                       this machine's own header (30 godot, 24 playwright, 8 hindsight, rest kit)
 *   Nothing is written outside stdout.
 *
 * OUTPUTS
 *   One line per preset and workspace kind (kept families, denied count, bytes removed), the
 *   assertion lines, then `n/m checks passed`; exit 0 only when every assertion holds.
 *
 * KEYWORDS
 *   tool families, preset, tool-gated MCP, request header, context economy, deny list, proof
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A pattern matching nothing is reported per preset (an MCP server that is down leaves the
 *     policy with nothing to deny) and is not an assertion failure.
 *   - `--from-session` reads every frame with the CLI zstd decoder; a missing or unreadable
 *     session is a failure, never a silent fallback to the synthetic list.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const value = (name) => {
  const at = argv.indexOf(name)
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : ''
}
const pluginPath = value('--plugin') !== '' ? resolve(value('--plugin')) : join(KIT, 'plugins', 'tool-families', 'tool-families.mjs')
const sessionDir = value('--from-session')

/** The tool names this machine actually offers, grouped the way the policy thinks. */
function syntheticNames() {
  const names = []
  const godot = ['batch_execute', 'editor_manage', 'editor_reload_plugin', 'editor_screenshot', 'editor_state', 'filesystem_manage', 'logs_read', 'material_manage', 'node_create', 'node_find', 'node_get_properties', 'node_manage', 'node_set_property', 'project_manage', 'project_run', 'resource_manage', 'scene_get_hierarchy', 'scene_manage', 'scene_open', 'scene_save', 'script_attach', 'script_create', 'script_manage', 'script_patch', 'session_activate', 'session_manage', 'signal_manage', 'test_manage', 'test_run', 'ui_manage']
  const playwright = ['browser_click', 'browser_close', 'browser_console_messages', 'browser_drag', 'browser_drop', 'browser_evaluate', 'browser_file_upload', 'browser_fill_form', 'browser_find', 'browser_handle_dialog', 'browser_hover', 'browser_navigate', 'browser_navigate_back', 'browser_network_request', 'browser_network_requests', 'browser_press_key', 'browser_resize', 'browser_run_code_unsafe', 'browser_select_option', 'browser_snapshot', 'browser_tabs', 'browser_take_screenshot', 'browser_type', 'browser_wait_for']
  for (const name of godot) names.push(`mcp__godot__${name}`)
  for (const name of playwright) names.push(`mcp__playwright__${name}`)
  for (const name of ['capture_initiative', 'diagnose', 'ingest_document', 'list_pages', 'read_page', 'reflect', 'search_pages', 'sync_status']) names.push(`hindsight_${name}`)
  names.push('bash', 'read', 'write', 'edit', 'grep', 'glob', 'task_create', 'case_record', 'skill', 'todo_write')
  return names
}

/** Real tool records (name + JSON schema bytes) from a session log's first `request/header`. */
function schemasFromSession(dir) {
  const log = join(dir, 'session.v4.jsonl.zstd')
  if (!existsSync(log)) throw new Error(`no session log at ${log}`)
  const text = execFileSync('zstd', ['-dc', log], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
  for (const line of text.split('\n')) {
    if (!line.includes('"request/header"')) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type !== 'request/header') continue
    const tools = event.data?.header?.tools ?? []
    if (tools.length > 0) {
      return tools
        .filter((tool) => typeof tool?.name === 'string')
        .map((tool) => ({ name: tool.name, bytes: JSON.stringify(tool).length }))
        .sort((a, b) => b.bytes - a.bytes)
    }
  }
  throw new Error(`no request/header with tools in ${log}`)
}

const schemas = sessionDir ? schemasFromSession(sessionDir) : null
const visible = schemas ? schemas.map((schema) => schema.name) : syntheticNames()
const totalBytes = schemas ? schemas.reduce((total, schema) => total + schema.bytes, 0) : 0
const { normalizeConfig, decide, removedBytes, apply, matches: matchesName } = await import(pathToFileURL(pluginPath).href)

// The shipped policy, copied from profile/cordis.patch.yml. Duplication is deliberate: this
// script must be able to test a DIFFERENT plugin build against the agreed policy, so it does
// not read the live row (a drifted row is the defect it should catch, not its input).
const POLICY_RAW = {
  projectMarkers: { 'mcp__godot__*': 'project.godot' },
  families: {
    // Copied from profile/cordis.patch.yml (V1.1 allow lists); the app runs the same table.
    orchestrator: { allow: ['analysis_check', 'analysis_impact', 'analysis_read', 'analysis_upsert', 'ask_user_question', 'case_drift', 'case_get', 'case_list', 'case_record', 'delegate_task', 'delegation_brief', 'edit', 'glob', 'grep', 'hindsight_list_pages', 'hindsight_read_page', 'hindsight_search_pages', 'map_edit', 'map_list', 'map_read', 'map_render', 'outline', 'present', 'read', 'skill', 'skill_evolve', 'skill_inventory', 'task_cancel', 'task_close', 'task_create', 'task_get', 'task_list', 'task_note', 'task_stop', 'task_update', 'todo_write', 'web_fetch', 'web_search', 'write'] },
    backend: { allow: ['bash', 'case_get', 'case_list', 'case_record', 'case_run', 'case_suite', 'edit', 'glob', 'grep', 'job_output', 'read', 'read_image', 'skill', 'task_get', 'task_note', 'write'] },
    reviewer: { allow: ['bash', 'case_gate', 'case_get', 'case_list', 'case_run', 'glob', 'grep', 'present', 'read', 'read_image', 'skill', 'task_get', 'task_note', 'todo_write'] },
    critic: { allow: ['bash', 'case_get', 'case_list', 'case_run', 'glob', 'grep', 'job_output', 'present', 'read', 'read_image', 'skill', 'task_get', 'task_note', 'todo_write'] },
    gatherer: { allow: ['bash', 'glob', 'grep', 'read', 'read_image', 'skill', 'task_get', 'task_note', 'todo_write', 'working_directory'] },
    research: { allow: ['glob', 'grep', 'papers_download', 'papers_search', 'papers_trending', 'read', 'read_image', 'skill', 'task_get', 'task_note', 'todo_write', 'web_fetch', 'web_search', 'write'] },
    docs: { allow: ['case_get', 'case_list', 'case_record', 'edit', 'glob', 'grep', 'read', 'skill', 'task_get', 'task_note', 'todo_write', 'web_fetch', 'web_search', 'write'] },
    ux: { allow: ['bash', 'case_list', 'case_record', 'edit', 'glob', 'grep', 'mcp__playwright__*', 'present', 'read', 'read_image', 'skill', 'task_get', 'task_note', 'todo_write', 'web_fetch', 'web_search', 'write'] },
    presenter: { allow: ['bash', 'dashboard', 'diagram', 'edit', 'glob', 'grep', 'job_kill', 'job_list', 'job_output', 'mcp__playwright__*', 'outline', 'present', 'presentation', 'read', 'read_image', 'skill', 'task_get', 'task_note', 'todo_write', 'web_fetch', 'web_search', 'write'] },
  },
}
const BUDGETS = { orchestrator: 42, presenter: 36, backend: 16, reviewer: 14, critic: 14, gatherer: 10, research: 14, docs: 14, ux: 40 }
const POLICY = normalizeConfig(POLICY_RAW)

const PRESETS = [undefined, 'orchestrator', 'ux', 'presenter', 'backend', 'reviewer', 'critic', 'research', 'gatherer', 'docs', 'a-preset-nobody-wrote']
const WORKSPACES = [
  { label: 'dsh-kit', marker: false },
  { label: 'godot-project', marker: true },
]

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

/** Kept family → does any visible tool of that family survive the decision? */
function keptFamilies(decision, family) {
  return visible.some((name) => name.startsWith(family) && !decision.deny.includes(name))
}

console.log(`tools under test: ${visible.length} (${sessionDir ? `session ${sessionDir}` : 'synthetic header'})\n`)
const table = []
for (const workspace of WORKSPACES) {
  console.log(`workspace: ${workspace.label}${workspace.marker ? ' (project.godot present)' : ' (no project.godot)'}`)
  for (const preset of PRESETS) {
    const decision = decide(POLICY, preset, { visible, hostHas: (marker) => workspace.marker && marker === 'project.godot' })
    const bytes = schemas
      ? schemas.filter((schema) => decision.deny.includes(schema.name)).reduce((total, schema) => total + schema.bytes, 0)
      : decision.deny.length
    table.push({ workspace: workspace.label, preset, decision, bytes })
    console.log(
      `  ${String(preset ?? 'standard').padEnd(20)} deny=${String(decision.deny.length).padStart(3)} kept=${String(visible.length - decision.deny.length).padStart(3)} tools ${String(bytes).padStart(6)} B`
        + ` | playwright=${keptFamilies(decision, 'mcp__playwright__') ? 'kept' : 'gone'}`
        + ` godot=${keptFamilies(decision, 'mcp__godot__') ? 'kept' : 'gone'}`
        + ` hindsight=${keptFamilies(decision, 'hindsight_') ? 'kept' : 'gone'}`
        + `${decision.keptProjectDeny.length ? ` | project-kept: ${decision.keptProjectDeny.join(',')}` : ''}`
        + `${decision.unmatched.length ? ` | unmatched: ${decision.unmatched.join(',')}` : ''}`,
    )
  }
  console.log('')
}

const row = (workspace, preset) => table.find((entry) => entry.workspace === workspace && entry.preset === preset)

// ── the contract ──────────────────────────────────────────────────────────────
const ROWS = Object.keys(POLICY_RAW.families)
const keeps = (decision, name) => !decision.deny.includes(name)
const keptNames = (decision) => visible.filter((name) => !decision.deny.includes(name))

// 1. A preset with no row keeps everything (D8: standard, cordis, ptc, unknown).
for (const workspace of WORKSPACES) {
  for (const preset of [undefined, 'a-preset-nobody-wrote']) {
    check(
      `${preset ?? 'standard'} (no row) keeps its whole surface in ${workspace.label}`,
      row(workspace.label, preset).decision.deny.length === 0,
      `deny=${row(workspace.label, preset).decision.deny.length}`,
    )
  }
}

// 2. Every row keeps ONLY names its allow list matches: nothing leaks from the host.
for (const workspace of WORKSPACES) {
  for (const preset of ROWS) {
    const decision = row(workspace.label, preset).decision
    const allow = POLICY.families[preset].allow
    const strays = keptNames(decision).filter((name) => !allow.some((pattern) => matchesName(name, pattern)))
    check(
      `"${preset}" keeps only allow-listed names in ${workspace.label}`,
      strays.length === 0,
      strays.length === 0 ? `kept=${keptNames(decision).length}` : `leaked=${strays.slice(0, 4).join(',')}`,
    )
  }
}

// 3. The budget is a ceiling on the kept set, checked against a REAL header too.
for (const preset of ROWS) {
  for (const workspace of WORKSPACES) {
    const kept = keptNames(row(workspace.label, preset).decision).length
    check(`"${preset}" stays within its budget in ${workspace.label}`, kept <= BUDGETS[preset], `${kept} <= ${BUDGETS[preset]}`)
  }
}

// 4. The families the design excludes are gone; Playwright is the browser-seat exception
// (ux designs an interface, presenter looks at its own rendered deck).
const BROWSER_SEATS = new Set(['ux', 'presenter'])
for (const preset of ROWS) {
  const decision = row('dsh-kit', preset).decision
  check(`playwright ${BROWSER_SEATS.has(preset) ? 'kept' : 'removed'} for preset "${preset}"`, keptFamilies(decision, 'mcp__playwright__') === BROWSER_SEATS.has(preset))
}
for (const workspace of WORKSPACES) {
  for (const preset of ROWS) {
    check(`godot removed for preset "${preset}" in ${workspace.label}`, keptFamilies(row(workspace.label, preset).decision, 'mcp__godot__') === false)
  }
}
for (const preset of ROWS) {
  const kept = keptNames(row('dsh-kit', preset).decision).filter((name) => name.startsWith('hindsight_'))
  check(
    `hindsight ${preset === 'orchestrator' ? 'kept (read half)' : 'removed'} for preset "${preset}"`,
    preset === 'orchestrator' ? kept.length === 3 : kept.length === 0,
    `kept=${kept.join(',') || '(none)'}`,
  )
}

// 5. deny and projectDeny still subtract from an allow list.
const denyDecision = decide(normalizeConfig({ families: { backend: { allow: ['read', 'write'], deny: ['write'] } } }), 'backend', { visible })
check(
  'a deny pattern still subtracts from an allow list',
  denyDecision.deny.includes('write') === true && denyDecision.deny.includes('bash') === true,
  `deny=${denyDecision.deny.slice(0, 3).join(',')}…`,
)
const projectEntry = normalizeConfig({ projectMarkers: { 'mcp__godot__*': 'project.godot' }, families: { backend: { allow: ['mcp__godot__*', 'read'], projectDeny: ['mcp__godot__*'] } } })
const godotVisible = visible.filter((name) => name.startsWith('mcp__godot__'))
const outsideProject = decide(projectEntry, 'backend', { visible, hostHas: () => false })
const insideProject = decide(projectEntry, 'backend', { visible, hostHas: () => true })
check(
  'projectDeny still keeps an allowed family only inside a marked project',
  outsideProject.deny.filter((name) => name.startsWith('mcp__godot__')).length === godotVisible.length
    && insideProject.deny.filter((name) => name.startsWith('mcp__godot__')).length === 0,
  `outside=${outsideProject.deny.filter((name) => name.startsWith('mcp__godot__')).length}/${godotVisible.length} inside=0`,
)
check(
  'an allow pattern matching nothing is not an error',
  decide(POLICY, 'backend', { visible: ['read'], hostHas: () => false }).deny.length === 0,
)

// 7. Bytes: with a real header the kept schema budget is quoted directly.
if (schemas) {
  const keptBytes = (preset) => schemas.filter((schema) => !row('dsh-kit', preset).decision.deny.includes(schema.name)).reduce((total, schema) => total + schema.bytes, 0)
  check(
    'the saving is real: a plain-repository backend keeps <= 20% of the header schema bytes',
    keptBytes('backend') <= totalBytes * 0.2,
    `${keptBytes('backend')} B of ${totalBytes} B; orchestrator ${keptBytes('orchestrator')} B`,
  )
} else {
  console.log(`  [note] schema bytes need --from-session (a real request/header carries sizes); names only here`)
}

// ── lifecycle: the preset is read from the projection, and a change recomputes ──
// The defect this section exists for (measured on a second server 2026-11-17): a session
// created under `orchestrator` and switched to `backend` kept the orchestrator restriction and
// received all 24 `mcp__playwright__*` tools the backend row denies, because the plugin read
// `session.header.agentPreset` (the creation value) and marked the agent done after one pass.
console.log('\nlifecycle: a preset selected after the session exists')
const fakeSchemas = visible.map((name) => ({ name, description: '', inputSchema: { type: 'object' } }))
const lifecycleCtx = () => {
  const handlers = { 'agent/created': [], 'agent/pre-step': [], 'session/event': [] }
  const restricts = []
  const lifted = []
  const infos = []
  const projection = new Map()
  const liveAgents = new Map()
  const provided = new Map()
  const ctx = {
    on(event, handler) {
      (handlers[event] ??= []).push(handler)
    },
    provide(name, service) {
      provided.set(name, service)
      return service
    },
    effect(fn) {
      fn()
      return () => {}
    },
    get(name) {
      if (name === 'agentPresets') return { presetForSession: (session) => projection.get(session?.id) }
      if (name === 'agents') return { get: (id) => liveAgents.get(id) }
      return provided.get(name)
    },
    tools: { schemas: () => fakeSchemas },
    logger: { info: (message) => infos.push(String(message)) },
  }
  // `ctx.root` is the root context: the row and the registry are siblings, and Cordis raises an
  // event upward, so a sibling's own `on` never sees the other's emission.
  ctx.root = ctx
  return { ctx, liveAgents, handlers, restricts, lifted, infos, projection, provided }
}
const fakeAgent = (env, creationPreset) => ({
  session: { id: 'probe-session', header: { agentPreset: creationPreset, cwd: KIT } },
  ctx: {
    tools: {
      schemas: () => fakeSchemas,
      restrict(filter) {
        // Mirror the registry: a probe for a nonexistent name throws and names the known set.
        const named = [...(filter.allow ?? []), ...(filter.deny ?? [])]
        const unknown = named.filter((name) => name === '__tool_families_probe__')
        if (unknown.length > 0) throw new Error(`tools.restrict() names unknown global tool "${unknown[0]}"; known global tools: ${visible.join(', ')}`)
        env.restricts.push(filter)
        return () => env.lifted.push(filter)
      },
    },
  },
})
const emitSelected = async (env, sessionId, preset) => {
  const session = { id: sessionId }
  const event = { type: 'agent-preset/selected', data: { agentPreset: preset } }
  for (const handler of env.handlers['session/event']) await handler(session, event)
}
const created = async (env, agent) => {
  for (const handler of env.handlers['agent/created']) await handler({ agent })
}
const preStep = async (env, agent) => {
  let continued = false
  for (const handler of env.handlers['agent/pre-step']) await handler({ agent }, async () => { continued = true })
  return continued
}
const env = lifecycleCtx()
apply(env.ctx, POLICY_RAW)
const agent = fakeAgent(env, 'orchestrator')
await created(env, agent)
check('created under orchestrator installs exactly one restriction', env.restricts.length === 1, `restricts=${env.restricts.length}`)
const createdDeny = env.restricts[0]?.deny ?? []
check(
  'the created restriction is the orchestrator deny (godot and playwright gone, bash gone)',
  createdDeny.some((name) => name.startsWith('mcp__godot__')) && createdDeny.some((name) => name.startsWith('mcp__playwright__')) && createdDeny.includes('bash'),
  `deny=${createdDeny.length}`,
)
env.projection.set('probe-session', 'backend')
const continued = await preStep(env, agent)
check('pre-step runs next() (it is a waterfall participant)', continued === true)
check('a preset selected after creation recomputes: a second restriction is installed', env.restricts.length === 2, `restricts=${env.restricts.length}`)
const backendDeny = env.restricts[1]?.deny ?? []
check(
  'the recomputed restriction is the backend deny: playwright removed, bash kept',
  backendDeny.some((name) => name.startsWith('mcp__playwright__')) && !backendDeny.includes('bash'),
  `playwright=${backendDeny.filter((name) => name.startsWith('mcp__playwright__')).length} bash=${backendDeny.includes('bash')}`,
)
check('the previous (orchestrator) restriction is lifted, not stacked', env.lifted.length === 1, `lifted=${env.lifted.length}`)
check('the recompute is logged with the preset it came from', env.infos.some((line) => /preset "backend"/.test(line) && /recomputed from "orchestrator"/.test(line)), env.infos.at(-1) ?? '(none)')
const before = env.restricts.length
await preStep(env, agent)
check('a second step under the same preset installs nothing new', env.restricts.length === before, `restricts=${env.restricts.length}`)
env.projection.set('probe-session', 'a-preset-nobody-wrote')
await preStep(env, agent)
check('switching to a preset with no policy row lifts the restriction', env.lifted.length === 2 && env.restricts.length === before, `lifted=${env.lifted.length} restricts=${env.restricts.length}`)

// A preset selected while the session is still BLANK is the case where the projection cannot
// answer yet: `agent/created` must already know the chosen preset, or the FIRST request is
// built with the old one (measured: 91 tools with 24 playwright on request 1, 67 without on 2).
const earlyEnv = lifecycleCtx()
apply(earlyEnv.ctx, POLICY_RAW)
const earlyAgent = fakeAgent(earlyEnv, 'orchestrator')
earlyEnv.liveAgents.set('probe-session', earlyAgent)
await emitSelected(earlyEnv, 'probe-session', 'backend')
check('the ROOT session/event listener restricts the live agent at selection time', earlyEnv.restricts.length === 1, `restricts=${earlyEnv.restricts.length} (before any created/pre-step)` )
const earlyDeny = earlyEnv.restricts[0]?.deny ?? []
check(
  'that first restriction is the backend deny (playwright gone, bash kept)',
  earlyDeny.some((name) => name.startsWith('mcp__playwright__')) && !earlyDeny.includes('bash'),
  `playwright=${earlyDeny.filter((name) => name.startsWith('mcp__playwright__')).length} bash=${earlyDeny.includes('bash')}`,
)

// The selection may arrive before the agent is published (a blank session has none): it is
// remembered by session id and applied at `agent/created`, still before the first step.
const pendingEnv = lifecycleCtx()
apply(pendingEnv.ctx, POLICY_RAW)
await emitSelected(pendingEnv, 'probe-session', 'backend')
check('a selection with no live agent installs nothing yet', pendingEnv.restricts.length === 0, `restricts=${pendingEnv.restricts.length}`)
const pendingAgent = fakeAgent(pendingEnv, 'orchestrator')
await created(pendingEnv, pendingAgent)
const pendingDeny = pendingEnv.restricts[0]?.deny ?? []
check('the remembered selection is applied at agent/created', pendingEnv.restricts.length === 1 && pendingDeny.some((name) => name.startsWith('mcp__playwright__')), `restricts=${pendingEnv.restricts.length} playwright=${pendingDeny.filter((n) => n.startsWith('mcp__playwright__')).length}`)
check('the restriction installed for the remembered selection keeps bash', !pendingDeny.includes('bash'), `bash=${pendingDeny.includes('bash')}`)

// An unmatched pattern must not be recorded as applied: the MCP bridge may register later.
const unmatchedEnv = lifecycleCtx()
apply(unmatchedEnv.ctx, { families: { backend: { deny: ['mcp__absent__*'] } } })
const unmatchedAgent = fakeAgent(unmatchedEnv, 'backend')
unmatchedEnv.projection.set('probe-session', 'backend')
const firstTry = await preStep(unmatchedEnv, unmatchedAgent)
const secondTry = await preStep(unmatchedEnv, unmatchedAgent)
check(
  'an unmatched pattern is a retry, not an applied restriction',
  unmatchedEnv.restricts.length === 0 && unmatchedEnv.lifted.length === 0,
  `restricts=${unmatchedEnv.restricts.length} (next() called: ${firstTry}/${secondTry})`,
)

// ── policy facts: what the prompt owner is allowed to quote ─────────────────────
// A consumer that writes "this role has no <family>" must not hard-code the claim: the policy
// owns the facts. `ctx.provide('toolFamilies', …)` is the additive, optional contract; without
// it the consumer asserts nothing. The red-first case is the previous plugin build, which
// published no service at all.
console.log('\npolicy facts: the service the prompt owner reads')
const factsEnv = lifecycleCtx()
apply(factsEnv.ctx, POLICY_RAW)
const factsService = factsEnv.provided.get('toolFamilies')
check('apply publishes the `toolFamilies` service', factsService !== undefined && typeof factsService.factsFor === 'function' && typeof factsService.presetFor === 'function')
const factsAgent = fakeAgent(factsEnv, 'orchestrator')
check('factsFor is null before the policy is applied to an agent', factsService?.factsFor(factsAgent) === null)
await created(factsEnv, factsAgent)
const facts = factsService?.factsFor(factsAgent)
const removed = Array.isArray(facts?.removed) ? facts.removed : []
check(
  'the facts name the preset the policy was applied with',
  facts?.preset === 'orchestrator',
  `preset=${facts?.preset}`,
)
check(
  'the facts list only the patterns that really removed tools: playwright, godot and bash, never an unmatched pwsh',
  ['mcp__playwright__*', 'mcp__godot__*', 'bash'].every((pattern) => removed.includes(pattern)) && !removed.includes('pwsh'),
  `removed=${removed.join(',')}`,
)
check(
  'presetFor follows the projection for a session (a selection after creation wins)',
  (() => {
    factsEnv.projection.set('switch-session', 'backend')
    return factsService?.presetFor({ id: 'switch-session', header: { agentPreset: 'orchestrator' } }) === 'backend'
  })(),
)
const factsOther = fakeAgent(factsEnv, 'backend')
factsEnv.projection.set('probe-session', 'backend')
await created(factsEnv, factsOther)
const backendFacts = factsService?.factsFor(factsOther)
check(
  'a different preset gets its own facts, not the orchestrator ones',
  backendFacts?.preset === 'backend' && !(backendFacts?.removed ?? []).includes('bash'),
  `preset=${backendFacts?.preset} removed=${(backendFacts?.removed ?? []).join(',')}`,
)

// ── allows: the registration-time half of the policy ───────────────────────────
// tools.restrict masks only global and ancestor registrations; a kit plugin that registers a
// tool into the agent's own layer used to bypass the allow list entirely (measured 2026-11-18:
// the root carried case_*, delegation_*, diagram and the goal tools although the row named none
// of them). Those plugins now ask this service before registering, so the row is the one owner
// of the role surface.
console.log('\nregistration time: the row decides what a per-agent plugin may register')
const allowsAgent = (preset) => ({ session: { id: 'allows-' + preset, header: { agentPreset: preset, cwd: KIT } } })
check(
  'allows admits a tool the orchestrator row names',
  factsService?.allows(allowsAgent('orchestrator'), 'case_record') === true,
)
check(
  'allows refuses a tool the orchestrator row does not name',
  factsService?.allows(allowsAgent('orchestrator'), 'case_gate') === false,
)
check(
  'allows admits a tool the backend row names',
  factsService?.allows(allowsAgent('backend'), 'bash') === true,
)
check(
  'allows refuses a tool the backend row does not name',
  factsService?.allows(allowsAgent('backend'), 'task_list') === false,
)
check(
  'a preset without a row admits every tool',
  factsService?.allows(allowsAgent('a-preset-nobody-wrote'), 'anything_at_all') === true,
)

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exitCode = passed === results.length ? 0 : 1
