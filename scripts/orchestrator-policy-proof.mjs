#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove the root policy section of `@cc/dsh-orchestrator` against the REAL plugin modules,
 *   on a fake harness context: every root renders the common working policy, only the preset
 *   this policy describes appends the orchestration part, the section does not carry the old
 *   "you have no bash at all" literal, and the sentence about the session's tool set is derived
 *   from the facts `@cc/dsh-tool-families` publishes and frozen for the session.
 *
 * WHY IT EXISTS. The policy used to be registered on every root and stated a tool set as a
 * literal: a `cordis` root that carried `bash` among its tools read that it had no shell
 * (`docs/HARNESS-OVERVIEW.md` §8.2). The decisions are D1 (a section belongs to the preset it
 * describes) and D2 (the capability statement is assembled from the session's real tool set at
 * the first prompt and frozen) in `docs/analysis/kit-integrity-p0.json`. This script is the
 * red-first proof for that change: it fails on the previous plugin bytes (`--orchestrator`
 * pointing at 0.1.48) and passes on the fixed ones.
 *
 * INPUTS
 *   --orchestrator <path>    module under test (default plugins/orchestrator/orchestrator.mjs)
 *   --tool-families <path>   policy owner whose service the section reads
 *                            (default plugins/tool-families/tool-families.mjs)
 *   Nothing is written outside stdout.
 *
 * OUTPUTS
 *   One PASS/FAIL line per check and `n/m checks passed`; exit 0 only when every check holds.
 *   The fake harness supplies only what the two plugins call: `on`, `get`, `provide`, `effect`,
 *   `systemPrompt.section`, `taskboard.agents/list`, and a tools registry whose scoped view
 *   applies `restrict`. The real `apply` of both plugins runs, so registration scoping and the
 *   facts contract are observed rather than restated.
 *
 * KEYWORDS
 *   orchestrator policy, preset gate, tool set, tool-families service, prompt freeze,
 *   INV-PROMPT-FROZEN, INV-GENERATED, red-first proof
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A module that fails to import is a recorded FAILURE, not a crash: the red run against
 *     older bytes must still print every other observation.
 *   - The policy table below is COPIED from `profile/cordis.patch.yml` on purpose (the same
 *     reason `tool-families-proof.mjs` copies it): a drifted row is the defect this script
 *     should catch, so the profile is not its input.
 *   - The tool list is synthetic and shaped like this machine's header, so the run is
 *     deterministic and free: no model call and no server.
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const value = (name) => {
  const at = argv.indexOf(name)
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : ''
}
const modulePath = (name, fallback) => (value(name) !== '' ? resolve(value(name)) : join(KIT, fallback))
const orchestratorPath = modulePath('--orchestrator', 'plugins/orchestrator/orchestrator.mjs')
const toolFamiliesPath = modulePath('--tool-families', 'plugins/tool-families/tool-families.mjs')

/** The shipped family policy, copied from `profile/cordis.patch.yml`. */
const POLICY_RAW = {
  projectMarkers: { 'mcp__godot__*': 'project.godot' },
  families: {
    orchestrator: { deny: ['mcp__godot__*', 'mcp__playwright__*', 'bash', 'pwsh'] },
    ux: { projectDeny: ['mcp__godot__*'] },
    backend: { deny: ['mcp__playwright__*'], projectDeny: ['mcp__godot__*'] },
    reviewer: { deny: ['mcp__playwright__*'], projectDeny: ['mcp__godot__*'] },
    critic: { deny: ['mcp__playwright__*'], projectDeny: ['mcp__godot__*'] },
    research: { deny: ['mcp__playwright__*', 'mcp__godot__*'] },
    gatherer: { deny: ['mcp__playwright__*'], projectDeny: ['mcp__godot__*'] },
    docs: { deny: ['mcp__playwright__*', 'mcp__godot__*'] },
  },
}

/** The tool names this machine offers, in the families the policy thinks in. */
function hostTools({ withBash = true } = {}) {
  const names = []
  const godot = ['batch_execute', 'editor_manage', 'editor_reload_plugin', 'editor_screenshot', 'editor_state', 'filesystem_manage', 'logs_read', 'material_manage', 'node_create', 'node_find', 'node_get_properties', 'node_manage', 'node_set_property', 'project_manage', 'project_run', 'resource_manage', 'scene_get_hierarchy', 'scene_manage', 'scene_open', 'scene_save', 'script_attach', 'script_create', 'script_manage', 'script_patch', 'session_activate', 'session_manage', 'signal_manage', 'test_manage', 'test_run', 'ui_manage']
  const playwright = ['browser_click', 'browser_close', 'browser_console_messages', 'browser_drag', 'browser_drop', 'browser_evaluate', 'browser_file_upload', 'browser_fill_form', 'browser_find', 'browser_handle_dialog', 'browser_hover', 'browser_navigate', 'browser_navigate_back', 'browser_network_request', 'browser_network_requests', 'browser_press_key', 'browser_resize', 'browser_run_code_unsafe', 'browser_select_option', 'browser_snapshot', 'browser_tabs', 'browser_take_screenshot', 'browser_type', 'browser_wait_for']
  for (const name of godot) names.push(`mcp__godot__${name}`)
  for (const name of playwright) names.push(`mcp__playwright__${name}`)
  for (const name of ['capture_initiative', 'diagnose', 'ingest_document', 'list_pages', 'read_page', 'reflect', 'search_pages', 'sync_status']) names.push(`hindsight_${name}`)
  names.push('read', 'write', 'edit', 'grep', 'glob', 'task_create', 'delegate_task', 'skill', 'todo_write')
  if (withBash) names.push('bash')
  return names
}

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

let orchestratorModule
let toolFamiliesModule
let importError
try {
  orchestratorModule = await import(pathToFileURL(orchestratorPath).href)
  toolFamiliesModule = await import(pathToFileURL(toolFamiliesPath).href)
} catch (error) {
  importError = error instanceof Error ? error.message : String(error)
}

/** A fake harness: the two plugins' `apply` over one tools registry and one section capture. */
function harness({ tools = hostTools(), families = true } = {}) {
  const handlers = { 'agent/created': [], 'agent/pre-step': [], 'session/event': [] }
  const services = new Map()
  const agents = new Map()
  const projection = new Map()
  const restrictions = new Map()
  const sections = []
  const schemaOf = (name) => ({ name, description: '', inputSchema: { type: 'object' } })
  const visibleFor = (agent) => {
    const deny = restrictions.get(agent) ?? new Set()
    return tools.filter((name) => !deny.has(name)).map(schemaOf)
  }
  const ctx = {
    logger: { info() {}, warn() {}, debug() {} },
    on(event, handler) {
      (handlers[event] ??= []).push(handler)
    },
    provide(name, service) {
      services.set(name, service)
      return service
    },
    effect(fn) {
      fn()
      return () => {}
    },
    get(name) {
      if (name === 'agents') return { get: (id) => agents.get(id) }
      if (name === 'agentPresets') return { presetForSession: (session) => projection.get(session?.id) }
      return services.get(name)
    },
    tools: { schemas: () => tools.map(schemaOf) },
    taskboard: { agents: () => [], list: () => [] },
    systemPrompt: { getSectionOrder: () => undefined, section: () => {} },
  }
  // The policy owner listens for the preset selection on the ROOT context: Cordis raises an
  // event upward, never sideways to the row's own sibling context.
  ctx.root = ctx
  const installed = []
  const agentFor = (id, { preset, header = {} } = {}) => {
    const section = (entry) => sections.push({ agentId: id, ...entry })
    const agent = {
      id,
      session: { id, header: { id, cwd: KIT, agentPreset: preset, ...header } },
      ctx: {
        on() {},
        systemPrompt: { getSectionOrder: () => 100, section },
        tools: {
          schemas: () => visibleFor(agent),
          restrict(filter) {
            const deny = new Set(filter?.deny ?? [])
            restrictions.set(agent, deny)
            installed.push({ agent, deny })
            return () => {
              if (restrictions.get(agent) === deny) restrictions.delete(agent)
            }
          },
          guard() {},
          register() {},
        },
      },
    }
    agents.set(id, agent)
    return agent
  }
  const created = (agent) => {
    for (const handler of handlers['agent/created']) handler({ agent })
  }
  const emitSelected = (session, preset) => {
    const event = { type: 'agent-preset/selected', data: { agentPreset: preset } }
    for (const handler of handlers['session/event']) handler(session, event)
  }
  const emitTurnStart = (session) => {
    const event = { type: 'turn/start', data: {} }
    for (const handler of handlers['session/event']) handler(session, event)
  }
  if (families) toolFamiliesModule?.apply(ctx, POLICY_RAW)
  orchestratorModule?.apply(ctx, {})
  return { ctx, handlers, services, projection, agents, sections, tools, restrictions, installed, agentFor, created, emitSelected, emitTurnStart }
}

/** The section one agent received, by name. */
const sectionFor = (env, agentId, name) => env.sections.find((entry) => entry.agentId === agentId && entry.name === name)
const textOf = (section) => (section === undefined ? undefined : typeof section.text === 'function' ? section.text() : section.text)
/** The generated tool-set block, or '' when the policy asserts nothing. */
const claimOf = (text) => {
  const match = /## Your tool set \(deployment\)\n\n([^\n]+)/.exec(String(text ?? ''))
  return match === null ? '' : match[1]
}
const removedIn = (claim) => [...claim.matchAll(/`([^`]+)`/g)].map((match) => match[1])
/** The old literal, with or without the backticks the policy wrote around the tool name. */
const OLD_LITERAL = /you have no `?bash`? at all/

console.log(`orchestrator: ${orchestratorPath}\ntool-families: ${toolFamiliesPath}\n`)
check('both modules import', orchestratorModule !== undefined && toolFamiliesModule !== undefined, importError)
check('the plugin exports ROOT_POLICY and POLICY_PRESET', typeof orchestratorModule?.ROOT_POLICY === 'string' && typeof orchestratorModule?.POLICY_PRESET === 'string')
check(
  'ROOT_POLICY no longer contains the literal "you have no bash at all"',
  typeof orchestratorModule?.ROOT_POLICY === 'string' && !OLD_LITERAL.test(orchestratorModule.ROOT_POLICY),
)

// ── the described preset gets the section and a derived claim ──────────────────
{
  const env = harness({ tools: hostTools() })
  const root = env.agentFor('root-orchestrator', { preset: 'orchestrator' })
  env.created(root)
  const section = sectionFor(env, 'root-orchestrator', 'deployment:orchestrator-policy')
  check('a root on the described preset gets the orchestrator policy section', section !== undefined, env.sections.map((entry) => entry.name).join(','))
  const text = textOf(section) ?? ''
  // Every root renders the common part first (d4de360: "Let every root read the speed rules"),
  // and only the preset this policy describes appends ROOT_POLICY after it.
  check(
    'the section carries the common policy and then the root policy',
    text.startsWith('## Working policy (deployment)') && text.includes(orchestratorModule.ROOT_POLICY),
  )
  check('the section states the session tool set from the policy facts', text.includes('## Your tool set (deployment)'))
  const removed = removedIn(claimOf(text))
  check(
    'the claim lists what was really removed: playwright, godot and bash',
    ['mcp__playwright__*', 'mcp__godot__*', 'bash'].every((pattern) => removed.includes(pattern)),
    `removed=${removed.join(',')}`,
  )
  check('the claim never lists a pattern that matched no tool (pwsh on this host)', !removed.includes('pwsh') && !text.includes('`pwsh`'), `removed=${removed.join(',')}`)
  check('the claim is phrased as a removal, not as the old literal', /removed .* from this session's tool set/.test(text) && !OLD_LITERAL.test(text))
}

// ── a root whose preset this policy does not describe gets the common part only ──
// The common working policy is safe for every root (ROOT_COMMON_POLICY); what a root outside
// POLICY_PRESET must NOT receive is the orchestration part and its tool-set claim.
for (const preset of ['cordis', 'backend', 'standard']) {
  const env = harness({ tools: hostTools() })
  const root = env.agentFor(`root-${preset}`, { preset: preset === 'standard' ? undefined : preset })
  env.created(root)
  const section = sectionFor(env, `root-${preset}`, 'deployment:orchestrator-policy')
  const text = textOf(section)
  check(
    `a root on preset "${preset}" gets the common policy and no orchestration part`,
    section !== undefined &&
      String(text).startsWith('## Working policy (deployment)') &&
      !String(text).includes(orchestratorModule.ROOT_POLICY),
    `text=${JSON.stringify(String(text ?? '').slice(0, 40))}`,
  )
}

// ── a preset selected on a blank session before the first message ─────────────
{
  const env = harness({ tools: hostTools() })
  const root = env.agentFor('root-switched', { preset: 'orchestrator' })
  env.created(root)
  // The selection is committed while the session is still blank; the creation header keeps
  // `orchestrator` (the default). The registry projection is the authority at assembly time.
  env.projection.set('root-switched', 'cordis')
  env.emitSelected(root.session, 'cordis')
  const text = textOf(sectionFor(env, 'root-switched', 'deployment:orchestrator-policy'))
  check(
    'a session created under orchestrator and switched to cordis before the first message renders the common part only',
    String(text).startsWith('## Working policy (deployment)') && !String(text).includes(orchestratorModule.ROOT_POLICY),
    `text=${JSON.stringify(String(text ?? '').slice(0, 40))}`,
  )
}

// ── frozen: a registry change between two renders does not rewrite the claim ──
{
  const env = harness({ tools: hostTools() })
  const root = env.agentFor('root-frozen', { preset: 'orchestrator' })
  env.created(root)
  const section = sectionFor(env, 'root-frozen', 'deployment:orchestrator-policy')
  const first = textOf(section)
  const firstClaim = claimOf(first)
  // The registry changes between turns: the header gains a family the policy does not know,
  // the policy service disappears, and the turn boundary drops the per-turn memo.
  env.tools.push('mcp__newbridge__tool_one')
  env.services.delete('toolFamilies')
  env.emitTurnStart(root.session)
  const second = textOf(section)
  check('the text is byte-identical after the registry and the policy service change', second === first, `first=${String(first).length}B second=${String(second).length}B`)
  check('the frozen text still carries the same tool-set claim', claimOf(second) === firstClaim && firstClaim !== '', `claim=${JSON.stringify(firstClaim.slice(0, 80))}`)
}

// ── no policy service: assert nothing (not the old literal) ───────────────────
{
  const env = harness({ tools: hostTools(), families: false })
  const root = env.agentFor('root-noservice', { preset: 'orchestrator' })
  env.created(root)
  const text = textOf(sectionFor(env, 'root-noservice', 'deployment:orchestrator-policy')) ?? ''
  check(
    'without the policy service the section still exists',
    text.startsWith('## Working policy (deployment)') && text.includes(orchestratorModule.ROOT_POLICY),
  )
  check(
    'without the policy service the section asserts nothing about the tool set',
    !text.includes('## Your tool set (deployment)') && !OLD_LITERAL.test(text) && !text.includes('mcp__playwright__') && !text.includes('mcp__godot__'),
  )
}

// ── the claim follows the ACTUAL set, not the configured patterns ─────────────
{
  const env = harness({ tools: hostTools({ withBash: false }) })
  const root = env.agentFor('root-nobash', { preset: 'orchestrator' })
  env.created(root)
  const text = textOf(sectionFor(env, 'root-nobash', 'deployment:orchestrator-policy')) ?? ''
  const removed = removedIn(claimOf(text))
  check(
    'a host without a bash tool is not told that bash was removed',
    removed.includes('mcp__playwright__*') && removed.includes('mcp__godot__*') && !removed.includes('bash'),
    `removed=${removed.join(',')}`,
  )
}

// ── the child section is untouched ────────────────────────────────────────────
{
  const env = harness({ tools: hostTools() })
  const child = env.agentFor('child-backend', { preset: 'backend', header: { delegationDepth: 1, parentSession: 'root-orchestrator' } })
  env.created(child)
  const section = sectionFor(env, 'child-backend', 'deployment:specialist-policy')
  const text = textOf(section) ?? ''
  check('a delegated child still gets the specialist policy section, unchanged', text.startsWith('## Delegated specialist policy (deployment)') && !text.includes('## Your tool set (deployment)'))
}

const passed = results.filter((result) => result.ok).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exitCode = passed === results.length ? 0 : 1
