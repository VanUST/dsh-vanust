#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove the preset→tool-family policy before it touches a server: run the real decision
 *   function from `plugins/tool-families/tool-families.mjs` over a real tool list, for every
 *   preset, in both workspace kinds (a plain repository and a Godot checkout), and assert the
 *   contract the deployment agreed on:
 *
 *     Playwright  → standard, orchestrator, ux
 *     Godot       → standard, and backend/ux/reviewer/critic ONLY in a Godot workspace
 *     research/docs → no MCP family at all
 *     hindsight   → never removed, for any preset
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
const { normalizeConfig, decide, removedBytes, apply } = await import(pathToFileURL(pluginPath).href)

// The shipped policy, copied from profile/cordis.patch.yml. Duplication is deliberate: this
// script must be able to test a DIFFERENT plugin build against the agreed policy, so it does
// not read the live row (a drifted row is the defect it should catch, not its input).
const POLICY_RAW = {
  projectMarkers: { 'mcp__godot__*': 'project.godot' },
  families: {
    orchestrator: { deny: ['mcp__godot__*'] },
    ux: { projectDeny: ['mcp__godot__*'] },
    backend: { deny: ['mcp__playwright__*'], projectDeny: ['mcp__godot__*'] },
    reviewer: { deny: ['mcp__playwright__*'], projectDeny: ['mcp__godot__*'] },
    critic: { deny: ['mcp__playwright__*'], projectDeny: ['mcp__godot__*'] },
    research: { deny: ['mcp__playwright__*', 'mcp__godot__*'] },
    gatherer: { deny: ['mcp__playwright__*'], projectDeny: ['mcp__godot__*'] },
    docs: { deny: ['mcp__playwright__*', 'mcp__godot__*'] },
  },
}
const POLICY = normalizeConfig(POLICY_RAW)

const PRESETS = [undefined, 'orchestrator', 'ux', 'backend', 'reviewer', 'critic', 'research', 'gatherer', 'docs', 'a-preset-nobody-wrote']
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
      `  ${String(preset ?? 'standard').padEnd(20)} deny=${String(decision.deny.length).padStart(3)} tools ${String(bytes).padStart(6)} B`
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
const playwrightKept = ['orchestrator', 'ux']
const godotInGodot = ['backend', 'ux', 'reviewer', 'critic']

check(
  'standard (no preset) keeps every family in a plain repository',
  keptFamilies(row('dsh-kit', undefined).decision, 'mcp__playwright__') && keptFamilies(row('dsh-kit', undefined).decision, 'mcp__godot__'),
  `deny=${row('dsh-kit', undefined).decision.deny.length}`,
)
// A preset nobody wrote a policy for is checked on its own below: the loops here are the
// agreed role list, and asserting the safe default per role would contradict it.
const ROLES = PRESETS.filter((p) => p !== undefined && p !== 'a-preset-nobody-wrote')
for (const preset of ROLES) {
  const plain = keptFamilies(row('dsh-kit', preset).decision, 'mcp__playwright__')
  check(`playwright ${playwrightKept.includes(preset) ? 'kept' : 'removed'} for preset "${preset}"`, plain === playwrightKept.includes(preset), `kept=${plain}`)
}
for (const preset of ROLES) {
  const plain = keptFamilies(row('dsh-kit', preset).decision, 'mcp__godot__')
  check(`godot removed for preset "${preset}" outside a Godot workspace`, plain === false, `kept=${plain}`)
}
for (const preset of godotInGodot) {
  check(`godot kept for "${preset}" INSIDE a Godot workspace`, keptFamilies(row('godot-project', preset).decision, 'mcp__godot__') === true)
}
for (const preset of ['orchestrator', 'research', 'docs']) {
  check(`godot still removed for "${preset}" inside a Godot workspace`, keptFamilies(row('godot-project', preset).decision, 'mcp__godot__') === false)
}
for (const preset of ['research', 'docs']) {
  const entry = row('godot-project', preset).decision
  check(`"${preset}" carries NO MCP family in any workspace`, keptFamilies(entry, 'mcp__playwright__') === false && keptFamilies(entry, 'mcp__godot__') === false)
}
for (const workspace of WORKSPACES) {
  for (const preset of PRESETS) {
    check(
      `hindsight survives for ${preset ?? 'standard'} in ${workspace.label}`,
      keptFamilies(row(workspace.label, preset).decision, 'hindsight_') === true,
    )
  }
}
check(
  'a preset nobody wrote a policy for keeps its whole surface',
  row('dsh-kit', 'a-preset-nobody-wrote').decision.deny.length === 0,
)
const backendPlainBytes = row('dsh-kit', 'backend').bytes
if (schemas) {
  check(
    'the saving is real: a plain-repository backend drops >= 60% of the header schema bytes',
    backendPlainBytes > totalBytes * 0.6,
    `${backendPlainBytes} B of ${totalBytes} B (${visible.length} tools); orchestrator ${row('dsh-kit', 'orchestrator').bytes} B`,
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
  const ctx = {
    on(event, handler) {
      (handlers[event] ??= []).push(handler)
    },
    get(name) {
      if (name === 'agentPresets') return { presetForSession: (session) => projection.get(session?.id) }
      if (name === 'agents') return { get: (id) => liveAgents.get(id) }
      return undefined
    },
    tools: { schemas: () => fakeSchemas },
    logger: { info: (message) => infos.push(String(message)) },
  }
  // `ctx.root` is the root context: the row and the registry are siblings, and Cordis raises an
  // event upward, so a sibling's own `on` never sees the other's emission.
  ctx.root = ctx
  return { ctx, liveAgents, handlers, restricts, lifted, infos, projection }
}
const fakeAgent = (env, creationPreset) => ({
  session: { id: 'probe-session', header: { agentPreset: creationPreset, cwd: KIT } },
  ctx: {
    tools: {
      schemas: () => fakeSchemas,
      restrict(filter) {
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
check(
  'the created restriction is the orchestrator deny (godot gone, playwright kept)',
  env.restricts[0].deny.some((name) => name.startsWith('mcp__godot__')) && !env.restricts[0].deny.some((name) => name.startsWith('mcp__playwright__')),
  `deny=${env.restricts[0].deny.length}`,
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

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exitCode = passed === results.length ? 0 : 1
