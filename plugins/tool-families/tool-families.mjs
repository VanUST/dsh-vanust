/**
 * PURPOSE
 *   Give each agent preset only the tool FAMILIES its job needs, by removing the rest
 *   from that agent's own view before the first request is derived.
 *
 * WHY THIS IS A HOST PLUGIN, NOT A PRESET ROW
 *   MCP tools are registered once, at the host, by the bridge (`@deepseek-ai/dsh-mcp-client`
 *   rows in the home patch layer) — a `mcp__godot__*` tool exists before any preset is
 *   chosen, and a preset cannot unregister a host tool. What an agent CAN do is
 *   `agent.ctx.tools.restrict({ deny })` (`dsh-tools` "Restrict global tools for the
 *   calling agent scope"), which the registry applies per agent scope and re-derives the
 *   visible schema set from, so a denied family leaves the request header instead of only
 *   being refused at call time. One host row therefore serves every preset, and the policy
 *   is config.
 *
 * WHY IT MATTERS (measured on a real child, 2026-11-13)
 *   A BACKEND child was offered 107 tools totalling 114,989 bytes of JSON schema:
 *   `mcp__godot__*` 30 tools / 60,679 B (52.8%), `mcp__playwright__*` 24 / 16,280 B (14.2%),
 *   `hindsight_*` 8 / 6,375 B (5.5%), every kit tool together ~20%. Two thirds of the
 *   per-step prefix that a role never uses is the largest context item this deployment
 *   controls, and it is re-sent every step.
 *
 * INPUTS
 *   Config:
 *     families      { [presetId]: { deny?: [patterns], projectDeny?: [patterns],
 *                                    allow?: [patterns] } }.
 *                   A pattern is an exact tool name or a family prefix ending in `*`.
 *                   `deny` is denied for that preset everywhere.
 *                   `projectDeny` is denied unless the session's cwd holds the marker
 *                   declared for that family in `projectMarkers`: a bridge that drives a
 *                   PROJECT is a capability only where that project is. Without this,
 *                   "the backend role may use the Godot tools" would put an editor bridge
 *                   in every repository the role ever opens.
 *                   Everything is expanded against the tool names the agent can actually
 *                   see and passed to `tools.restrict`; `allow` is forwarded unchanged.
 *                   A preset that is absent (and a session with NO preset, i.e. the
 *                   hands-on `standard` composition) keeps its full surface: a new role
 *                   must not lose tools because nobody wrote a row for it yet.
 *     projectMarkers { [pattern]: markerFile } — which families are project bridges and
 *                   what file marks that project.
 *     disabled      true to load the row and restrict nothing (a one-line rollback).
 *
 * OUTPUTS
 *   An `agent/created` listener PLUS an `agent/pre-step` listener that re-reads the preset on
 *   every step. The preset comes from the `agentPresets` projection
 *   (`presetForSession(agent.session)`, the authority for a selection made AFTER the session
 *   exists) and falls back to `agent.session.header.agentPreset` (the value the session was
 *   created with). For a preset with an effective policy it calls
 *   `agent.ctx.tools.restrict({ deny })` before the first request header exists and logs the
 *   preset, the denied families, the removed tool count and the schema bytes that leave the
 *   prefix. On a preset CHANGE it lifts the previous restriction (the disposer returned by
 *   `restrict`) and installs the new one, so the earlier preset's denies are not left in
 *   force: `dsh-tools` intersects restrictions, so stacking two calls would keep both.
 *   A `toolFamilies` service (`ctx.provide`, optional for the consumer) publishes the policy
 *   facts: the preset in force for a session and the patterns that actually removed tools
 *   from one agent, so a prompt owner states the session's real tool set instead of a literal.
 *   No tool, no prompt section, no session event.
 *
 * KEYWORDS
 *   preset, tool family, MCP, tools.restrict, context economy, godot, playwright, role surface
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No `families` config: every preset keeps its surface (a no-op row).
 *   - A pattern that matches no visible tool: logged, never thrown. An MCP server that is
 *     down, or a renamed tool, must not break a boot or a chat.
 *   - The restriction is applied at creation only. Restricting after a turn would rewrite
 *     the prefix mid-session and re-bill it, which is the failure this exists to avoid.
 *   - Hindsight is never in a policy row: a memory tool a child can call is a capability,
 *     not a family of the role's job.
 *   - A context without a scoped tools registry (a bare headless assembly) is skipped; this
 *     is a context-economy measure, never a permission boundary.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineTool, projectToolSchema } from '@deepseek-ai/dsh-tools'

/**
 * The tools registry is the only service this row touches.
 *
 * WHY THE HOST VIEW, NOT THE AGENT'S: the names of the families are needed to turn a pattern
 * into the exact tool names `tools.restrict` accepts, and an agent-scoped `tools.schemas()` at
 * `agent/created` is not guaranteed to expose host-plane (MCP) tools yet — measured on a second
 * server 2026-11-13: the policy resolved to an empty deny list and the header kept all 24
 * `mcp__playwright__*` schemas. The plugin's own context is the host plane, which is where the
 * bridge registers them, so the snapshot is taken there and `restrict` is still called through
 * `agent.ctx` (it refuses a context-global restriction by design).
 */
export const inject = ['tools', 'systemPrompt']

/** Does a tool name match a pattern? `prefix*` is a family, anything else is exact. */
export function matches(name, pattern) {
  if (typeof name !== 'string' || typeof pattern !== 'string') return false
  if (pattern.endsWith('*')) return name.startsWith(pattern.slice(0, -1))
  return name === pattern
}

/**
 * Normalize the raw row config.
 *
 * @param raw - the `config` block of the loader row.
 * @returns { families, projectMarkers, disabled }
 */
export function normalizeConfig(raw = {}) {
  const clean = (list) => (Array.isArray(list) ? list.filter((p) => typeof p === 'string' && p.trim() !== '') : [])
  const families = {}
  const source = raw?.families !== null && typeof raw?.families === 'object' ? raw.families : {}
  for (const [preset, entry] of Object.entries(source)) {
    if (entry === null || typeof entry !== 'object') continue
    const allow = clean(entry.allow)
    families[preset] = {
      deny: clean(entry.deny),
      projectDeny: clean(entry.projectDeny),
      ...(allow.length ? { allow } : {}),
    }
  }
  const projectMarkers = {}
  const markers = raw?.projectMarkers !== null && typeof raw?.projectMarkers === 'object' ? raw.projectMarkers : {}
  for (const [pattern, marker] of Object.entries(markers)) {
    if (typeof marker === 'string' && marker.trim() !== '') projectMarkers[pattern] = marker.trim()
  }
  return { families, projectMarkers, disabled: raw?.disabled === true }
}

/**
 * Decide the effective deny list for one agent.
 *
 * @param config - output of `normalizeConfig`.
 * @param preset - `agent.session.header.agentPreset`, may be undefined (standard).
 * @param options.visible - every tool name the agent can currently see.
 * @param options.hostHas - predicate: does `cwd` contain the project marker?
 * @returns { allow, deny, patterns, matched, removed, keptProjectDeny, unmatched } — `deny`
 *   holds exact names only. With an `allow` list the deny set is the complement: a name is
 *   removed when it matches no allow pattern (or is explicitly denied). `matched` names the
 *   configured deny patterns that hit; `removed` names what the consumer may quote — the
 *   matched patterns plus every removed family or exact name the allow list excluded.
 */
export function decide(config, preset, { visible = [], hostHas = () => false } = {}) {
  const empty = { allow: [], deny: [], patterns: [], matched: [], removed: [], keptProjectDeny: [], unmatched: [] }
  if (config.disabled) return empty
  const entry = preset === undefined || preset === null ? undefined : config.families[preset]
  if (entry === undefined) return empty

  const explicitlyDenied = new Set()
  const keptProjectDeny = []
  const matched = []
  const unmatched = []
  const add = (pattern) => {
    const hits = visible.filter((name) => matches(name, pattern))
    if (hits.length === 0) unmatched.push(pattern)
    else matched.push(pattern)
    for (const name of hits) explicitlyDenied.add(name)
  }
  for (const pattern of entry.deny ?? []) add(pattern)
  for (const pattern of entry.projectDeny ?? []) {
    // Kept only where the bridge has a project to drive.
    const marker = config.projectMarkers[pattern]
    if (marker !== undefined && hostHas(marker)) {
      keptProjectDeny.push(pattern)
      continue
    }
    add(pattern)
  }

  const allow = Array.isArray(entry.allow) ? entry.allow : []
  // The allow list is a complement filter: everything the list does not name is removed,
  // unless the explicit deny/projectDeny already removed it (then it is still removed).
  const outsideAllow = allow.length === 0 ? [] : visible.filter((name) => !allow.some((pattern) => matches(name, pattern)))
  const deny = visible.filter((name) => explicitlyDenied.has(name) || outsideAllow.includes(name))
  const removed = describeRemoved({ visible, deny, allow, matched })
  return { allow, deny, patterns: [...(entry.deny ?? []), ...(entry.projectDeny ?? [])], matched, removed, keptProjectDeny, unmatched }
}

/** Prefix a family label ends with, so `mcp__godot__scene_open` and `hindsight_read_page` group. */
function familyOf(name) {
  if (name.startsWith('mcp__')) {
    const parts = name.split('__')
    return parts.length >= 3 ? `${parts[0]}__${parts[1]}__` : name
  }
  const match = /^([a-z0-9]+)_/.exec(name)
  return match === null ? name : `${match[1]}_`
}

/**
 * What a consumer may quote as removed.
 *
 * With an allow list the claim is about the COMPLEMENT, which is far larger than the deny
 * patterns: a whole family that the list never mentions is quoted as `family*`; a family the
 * list keeps only in part is quoted by exact name, because `task_*` would be false while
 * `task_get` is still there.
 */
export function describeRemoved({ visible, deny, allow, matched }) {
  if (allow.length === 0) return [...new Set(matched)]
  const out = new Set(matched)
  const groups = new Map()
  for (const name of deny) {
    if (matched.some((pattern) => matches(name, pattern))) continue
    const prefix = familyOf(name)
    if (!groups.has(prefix)) groups.set(prefix, [])
    groups.get(prefix).push(name)
  }
  for (const [prefix, names] of groups) {
    const visibleInFamily = visible.filter((name) => familyOf(name) === prefix)
    if (visibleInFamily.length > 1 && names.length === visibleInFamily.length) out.add(`${prefix}*`)
    else for (const name of names) out.add(name)
  }
  return [...out]
}

/**
 * The names `tools.restrict()` can mask for this agent.
 *
 * `restrict()` masks GLOBAL registrations only; a preset-scoped tool (`bash`, `analysis_*`,
 * `delegate_task`) stays visible and naming it in a filter throws. The registry does not expose
 * its restrictable set, but the error does, so one deliberate probe per agent reads it. The
 * probe names a tool that cannot exist, so it installs nothing.
 */
function restrictableNames(agent) {
  try {
    agent.ctx.tools.restrict({ deny: ['__tool_families_probe__'] })
  } catch (error) {
    const line = /known global tools: (.*)$/.exec(String(error?.message ?? ''))?.[1]
    if (line === undefined) return undefined
    const names = line.split(', ').map((name) => name.trim()).filter((name) => name !== '')
    return new Set(names)
  }
  return undefined
}

/** Schema bytes of the denied tools — the number that makes the saving reviewable. */
export function removedBytes(schemas = [], deny = []) {
  return schemas
    .filter((schema) => deny.includes(schema?.name))
    .reduce((total, schema) => total + JSON.stringify(schema).length, 0)
}

/**
 * The PTC executor's generated SDK section, shadowed per agent.
 *
 * The 2026-11-27 measurement: one backend session carried 156,600 B of system prompt in
 * `## Writing code for run_code` — the TypeScript declaration of every visible tool,
 * `mcp__godot__*` and `mcp__playwright__*` included. It is re-sent every step, and a role
 * uses a handful of those tools per task. The declarations are not the contract: the
 * registry is. So the agent keeps a short header (what `run_code` is, which modules exist,
 * how to ask) and fetches the exact declaration on demand with `sdk_api`.
 *
 * WHY HERE, AND NOT IN THE PTC PLUGIN: the section is owned by
 * `PtcExecutor.renderSdk()` in `@deepseek-ai/dsh-tool-executor-ptc`; that package is
 * installed, not vendored by this kit. A scoped prompt section shadows an ancestor section
 * with the same name (`SystemPrompt.section()`), and the preset's plugins are mounted as a
 * parent scope of the agent scope (`dsh-agent-preset-registry` `bindScopeParent`), so a
 * section registered on `agent.ctx` shadows the preset's `tools:sdk` without touching the
 * executor or its tool semantics.
 */
const SDK_SECTION = 'tools:sdk'
const SDK_TOOL = 'sdk_api'

/** Label one tool with the module name the prompt header lists (a trailing `_` reads badly). */
function moduleOf(name) {
  return familyOf(name).replace(/_{1,2}$/, '')
}

/** Does a tool belong to the module the agent asked for? */
function inModule(name, module) {
  return name === module
    || name.startsWith(module)
    || name.startsWith(`mcp__${module}__`)
    || familyOf(name).startsWith(module)
}

/** The MCP server a tool belongs to (`mcp__godot__scene_open` → `godot`), or null. */
function mcpServerOf(name) {
  if (typeof name !== 'string' || !name.startsWith('mcp__')) return null
  const parts = name.split('__')
  return parts.length >= 3 && parts[1] !== '' ? parts[1] : null
}

/**
 * The hard ceiling on one `sdk_api` reply.
 *
 * MEASURED 2026-11-27: the generated declarations of one backend session were 37,820 B for 27
 * visible tools (~1.4 KB per tool), and a session that also carried `mcp__godot__*` and
 * `mcp__playwright__*` reached 156,600 B of system prompt. One module or one MCP server is the
 * unit of work; two of them are not. 64,000 B admits one server of 30 tools at ~2 KB each and
 * refuses every combination (two servers measured 92 KB on a synthetic set of the same shape),
 * so one reply fits one step's context and "give me everything" cannot exist even as a side
 * effect of a long name list.
 */
const SDK_REPLY_LIMIT = 64_000

/**
 * The short section that replaces the generated SDK.
 *
 * It MUST stay sufficient: the agent has to learn that `run_code` exists, which modules it
 * can reach, and how to ask for their API — otherwise it writes programs against names it
 * has not seen and the saving becomes blindness.
 */
export function sdkHeader(definitions = []) {
  const modules = new Map()
  const servers = new Map()
  for (const definition of definitions) {
    const name = definition?.name
    if (typeof name !== 'string' || name === '') continue
    const server = mcpServerOf(name)
    if (server !== null) {
      servers.set(server, (servers.get(server) ?? 0) + 1)
      continue
    }
    const module = moduleOf(name)
    modules.set(module, (modules.get(module) ?? 0) + 1)
  }
  const list = (groups) => [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([label, count]) => `${label} (${count})`)
    .join(', ')
  const serverLine = servers.size > 0
    ? `\nMCP servers visible in this session (tool count in parentheses): ${list(servers)}`
    : ''
  return `## Programming: \`run_code\`

\`run_code\` is the only tool you can call directly; a top-level call naming any other tool fails. Inside a program every visible tool is bound as \`tools.<name>(args)\`. The SDK declarations are NOT printed here — ask for them.

Modules visible in this session (tool count in parentheses): ${list(modules) || '(none)'}${serverLine}

Before writing a program that uses a tool, ask for the exact API of one module, one MCP server or a few names (the reply is capped at ${SDK_REPLY_LIMIT} B; a larger selection is refused and names what to choose instead):
- \`await tools.sdk_api({ module: 'task' })\` — one module above;
- \`await tools.sdk_api({ server: 'godot' })\` — one MCP server above;
- \`await tools.sdk_api({ names: ['read', 'grep'] })\` — named tools.
The reply is the real \`ToolArgsMap\`/\`ToolOutputMap\` declaration, not a summary. Call only names it declares.
`
}

/**
 * The on-demand declaration tool.
 *
 * It renders through the PTC package's own `renderToolsSdk`/`renderToolsSdkPy`, so the
 * answer is the declaration the prompt used to carry — not a retelling. The visible set is
 * the agent's own (after `tools.restrict`), so a project without the godot marker sees no
 * `mcp__godot__*` module at all.
 */
const SDK_TOOL_DEFINITION = defineTool({
  name: SDK_TOOL,
  description:
    'Exact SDK declarations for the tools visible in this session, fetched on demand instead of being printed in the system prompt. Call it from inside a run_code program before writing code against an unfamiliar tool: pass one module, one MCP server or a few exact names. Returns the real ToolArgsMap/ToolOutputMap code block, not a summary; a selection whose reply would exceed 64000 B is refused with what to choose instead.',
  parameters: {
    names: { type: 'array', items: { type: 'string' }, description: 'Exact tool names, for example read, grep, task_get.' },
    module: { type: 'string', description: 'One module from the prompt header, for example task, bash or outline.' },
    server: { type: 'string', description: 'One MCP server from the prompt header, for example godot or playwright.' },
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: String(value) }],
  },
  async execute(args, exec) {
    let visible = []
    try {
      const view = exec?.toolSet?.view?.(exec?.agent)
      visible = view === undefined
        ? (exec?.agent?.ctx?.tools?.definitions?.(exec.agent) ?? [])
        : [...view.values()]
    } catch {
      visible = []
    }
    const requested = Array.isArray(args?.names) ? args.names.filter((name) => typeof name === 'string') : []
    const module = typeof args?.module === 'string' ? args.module.trim().replace(/\*+$/, '') : ''
    const server = typeof args?.server === 'string'
      ? args.server.trim().replace(/^mcp__/, '').replace(/_+$/, '')
      : ''
    const modulesOf = () => [...new Set(visible.filter((definition) => mcpServerOf(definition?.name) === null).map((definition) => moduleOf(definition?.name)))].sort()
    const serversOf = () => [...new Set(visible.map((definition) => mcpServerOf(definition?.name)).filter((name) => name !== null))].sort()
    const choices = () =>
      `module '<one of: ${modulesOf().join(', ') || '(none)'}>' or server '<one of: ${serversOf().join(', ') || '(none)'}>'`
    let selected
    if (requested.length > 0) selected = visible.filter((definition) => requested.includes(definition?.name))
    else if (module !== '') selected = visible.filter((definition) => mcpServerOf(definition?.name) === null && inModule(definition?.name, module))
    else if (server !== '') selected = visible.filter((definition) => mcpServerOf(definition?.name) === server)
    else return `Specify what to declare: ${choices()}, or names: [...].`
    if (selected.length === 0) {
      return `Nothing matched. Visible modules: ${modulesOf().join(', ') || '(none)'}. Visible MCP servers: ${serversOf().join(', ') || '(none)'}.`
    }
    const { renderToolsSdk, renderToolsSdkPy } = await import('@deepseek-ai/dsh-tool-executor-ptc')
    const runtime = exec?.agent?.ctx?.get?.('ptcRuntime')
    const render = runtime?.language === 'python' ? renderToolsSdkPy : renderToolsSdk
    const schemas = selected.map((definition) => ({
      ...projectToolSchema(definition, false),
      output: definition?.output?.schema ?? {},
    }))
    const text = render(schemas, runtime?.programFormat)
    const bytes = Buffer.byteLength(String(text), 'utf8')
    if (bytes > SDK_REPLY_LIMIT) {
      return `That selection is ${bytes} B of declarations, over the ${SDK_REPLY_LIMIT} B limit for one reply. Ask for one module or one MCP server instead — ${choices()} — or fewer names.`
    }
    return text
  },
})


/**
 * Bind the policy for the lifetime of `ctx`.
 *
 * @param ctx - host context; needs `on` (and optionally `logger`).
 * @param config - see INPUTS.
 */
export function apply(ctx, config = {}) {
  const resolved = normalizeConfig(config)
  if (resolved.disabled) {
    try {
      ctx.logger?.info?.('tool-families: disabled by config; every preset keeps its full surface')
    } catch {
      // A logger that throws must not fail the boot.
    }
    return
  }
  const presets = Object.keys(resolved.families)
  if (presets.length === 0) return

  const debug = process.env.TOOL_FAMILIES_DEBUG === '1'
  /**
   * The policy IN FORCE on each agent: `{ preset, dispose }`.
   *
   * A WeakMap rather than a "settled" flag, because the preset can change after the agent
   * exists (the preset seat on an empty session): the map says which preset's restriction is
   * installed, so a different preset is a recompute and not a second, intersecting filter.
   */
  const applied = new WeakMap()

  /**
   * Presets selected on a session that has no agent yet (a blank session being set up).
   *
   * The choice is committed as `agent-preset/selected` BEFORE the first message exists — that
   * is the only moment early enough to restrict before the first request header is derived.
   * The projection cannot answer at `agent/created` (measured on a second server 2026-11-17:
   * `presetForSession` returned nothing there, so the row fell back to the creation header and
   * the FIRST request kept all 24 `mcp__playwright__*` tools; the restriction only reached the
   * second request). Keyed by session id, dropped once the agent has been seen.
   */
  const pending = new Map()
  const remember = (sessionId, preset) => {
    if (typeof sessionId === 'string' && typeof preset === 'string' && preset.trim() !== '') pending.set(sessionId, preset)
  }

  /**
   * The preset in force for an agent, read from the authority rather than the creation header.
   *
   * `agent.session.header.agentPreset` is only the value the session was CREATED with: a
   * selection made afterwards is committed as an `agent-preset/selected` event and reaches the
   * agent through the registry's `agentPreset` projection
   * (`dsh-agent-preset-registry/lib/index.js`, `presetForSession(session)`). Reading the header
   * alone kept the first preset's policy forever — measured on a second server 2026-11-17: a
   * session created under `orchestrator` and switched to `backend` still received all 24
   * `mcp__playwright__*` tools that the backend row denies.
   *
   * @returns the preset id, or undefined when the agent has none (the `standard` composition).
   */
  const resolvePreset = (agent) => {
    try {
      const fromProjection = ctx.get?.('agentPresets')?.presetForSession?.(agent?.session)
      if (typeof fromProjection === 'string' && fromProjection.trim() !== '') return fromProjection
    } catch {
      // A projection that is not mounted (a bare headless assembly) falls through to the header.
    }
    const selected = pending.get(agent?.session?.id)
    if (selected !== undefined) return selected
    const fromHeader = agent?.session?.header?.agentPreset
    return typeof fromHeader === 'string' && fromHeader.trim() !== '' ? fromHeader : undefined
  }

  /**
   * Bring one agent's restriction in line with its CURRENT preset.
   *
   * ORDERING IS THE WHOLE PROBLEM. The bridge registers MCP tools on the host plane, and the
   * agent's visible set is derived when a request is built. An `agent/created` call is the
   * earliest moment, but it is not guaranteed to be AFTER the bridge populated the global layer
   * (and `tools.restrict` validates every name against `restrictableNames`, so an unknown name
   * throws instead of being ignored). This runs at `agent/created` and on EVERY
   * `agent/pre-step` — before the request header of that step exists — so a preset selected
   * after creation, or a pattern that matched nothing yet, is recomputed.
   *
   * REPLACE, DO NOT STACK: `dsh-tools` intersects restrictions ("Restrictions intersect;
   * scoped registrations remain visible"), so a second `restrict` keeps the first preset's
   * denies. The disposer returned by the first call is kept and lifted before the new list
   * is installed.
   *
   * @returns true when the agent's restriction matches its preset (installed, lifted, or out
   *   of policy), false when the attempt has to be retried on the next step.
   */
  const applyTo = (agent, when, presetOverride) => {
    const preset = presetOverride ?? resolvePreset(agent)
    const current = applied.get(agent)
    if (current !== undefined && current.preset === preset) return true
    const cwd = agent?.session?.header?.cwd
    const tools = agent?.ctx?.tools
    if (typeof tools?.restrict !== 'function') {
      if (debug) console.error(`tool-families[debug:${when}]: no agent-scoped tools.restrict (preset=${preset})`)
      return false
    }
    const lift = (why) => {
      try {
        current.dispose?.()
      } catch {
        // A disposer is best-effort: the next restrict is still the current truth.
      }
      applied.delete(agent)
      if (debug) console.error(`tool-families[debug:${when}]: lifted the "${current.preset}" restriction (${why})`)
    }
    try {
      // The GLOBAL view: `schemas()` without a scope is the host plane, which is where the MCP
      // bridge registers and what `restrict` masks. An agent-scoped snapshot can be empty here.
      const hostSchemas = typeof ctx.tools?.schemas === 'function' ? ctx.tools.schemas() : []
      const agentSchemas = typeof tools.schemas === 'function' ? tools.schemas() : []
      const schemas = hostSchemas.length > 0 ? hostSchemas : agentSchemas
      const visible = schemas.map((schema) => schema?.name).filter((name) => typeof name === 'string')
      const has = (marker) => {
        if (typeof cwd !== 'string' || cwd === '') return false
        try {
          return existsSync(join(cwd, marker))
        } catch {
          return false
        }
      }
      const decision = decide(resolved, preset, { visible, hostHas: has })
      if (debug) {
        console.error(`tool-families[debug:${when}]: preset=${preset} host=${hostSchemas.length} agent=${agentSchemas.length} deny=${decision.deny.length} unmatched=${decision.unmatched.join(',') || '-'} kept=${decision.keptProjectDeny.join(',') || '-'}`)
      }
      // A preset without a row is out of policy: lift whatever the previous preset installed
      // and stop. A new role must not lose tools because nobody wrote a row for it yet.
      if (resolved.families[preset] === undefined) {
        if (current !== undefined) lift('the preset has no policy row')
        return true
      }
      // Nothing to deny with a pattern still unmatched: the MCP bridge may not have registered
      // yet, so this is a retry, not an applied state.
      if (decision.deny.length === 0 && decision.unmatched.length > 0) return false
      if (decision.deny.length === 0) {
        if (current !== undefined) lift('the current preset denies nothing here')
        if (decision.keptProjectDeny.length > 0) {
          ctx.logger?.info?.(`tool-families: preset "${preset}" keeps ${decision.keptProjectDeny.join(', ')} (project marker present in ${cwd})`)
        }
        return true
      }
      // A scoped tool (mounted by the preset) cannot be masked by `restrict()` and must not be
      // named: only the global names are the policy's business. The kept header therefore
      // includes the preset's own tools, which the budget counts.
      const restrictable = restrictableNames(agent)
      const entry = resolved.families[preset] ?? {}
      const globalDeny = restrictable === undefined ? decision.deny : decision.deny.filter((name) => restrictable.has(name))
      const scopedKept = decision.deny.length - globalDeny.length
      const narrowed = restrictable === undefined ? decision : decide(resolved, preset, { visible: [...restrictable], hostHas: has })
      const removed = narrowed.removed
      const bytes = removedBytes(schemas, globalDeny)
      if (current !== undefined) lift(`preset changed to "${preset}"`)
      const dispose = globalDeny.length === 0 ? undefined : tools.restrict({ deny: globalDeny })
      applied.set(agent, {
        preset,
        dispose: typeof dispose === 'function' ? dispose : undefined,
        matched: decision.matched,
        removed,
        keptProjectDeny: decision.keptProjectDeny,
      })
      ctx.logger?.info?.(
        `tool-families: preset "${preset}" denied ${globalDeny.length} global tool(s) (${bytes} B of schema) via ${decision.patterns.join(', ')}`
          + `${scopedKept > 0 ? `; ${scopedKept} preset-scoped tool(s) stay` : ''}`
          + `${current !== undefined ? ` [recomputed from "${current.preset}"]` : ''}`
          + `${decision.keptProjectDeny.length > 0 ? `; kept ${decision.keptProjectDeny.join(', ')}` : ''}`
          + `${decision.unmatched.length > 0 ? `; unmatched ${decision.unmatched.join(', ')}` : ''}`,
      )
      if (debug) console.error(`tool-families[debug:${when}]: applied ${decision.deny.length} deny name(s) for "${preset}"`)
      return true
    } catch (error) {
      // Reported, never thrown: a boot that cannot restrict still works, it just pays more.
      // The console line is deliberate: a `ctx.logger` warning does not reach the process
      // stdout that an operator reads while proving a change on a second server.
      console.error(`tool-families: ${when} could not restrict preset "${preset ?? 'none'}": ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  // The ONLY moment early enough for the first request header.
  //
  // Order inside a step is: tools resolve -> system prompt assembles -> `agent/pre-step`. The
  // first request header is derived from that resolution, so a `restrict` installed at
  // `agent/pre-step` can only reach the SECOND request (measured: 91 tools with 24
  // `mcp__playwright__*` on request 1, 67 without on request 2). The preset selection itself is
  // committed as a `session/event` of type `agent-preset/selected` while the session is still
  // blank — long before its first step.
  //
  // It must be heard on the ROOT context: this row and the `agentPresets` registry are
  // SIBLINGS, and Cordis raises an event to its ancestors, never sideways to a sibling.
  // `dsh-agent-preset-registry/lib/index.js` listens to the same `session/event` on its own
  // context and re-emits `agent-preset/selected` there, which is why listening on this row's
  // own context saw nothing.
  if (typeof ctx.root?.on === 'function') {
    ctx.root.on('session/event', (session, event) => {
      if (event?.type !== 'agent-preset/selected') return
      const preset = event?.data?.agentPreset
      const sessionId = session?.id
      if (typeof preset !== 'string' || preset.trim() === '') return
      const live = ctx.get?.('agents')?.get?.(sessionId)
      if (live !== undefined && live !== null) applyTo(live, 'selected', preset)
      else remember(sessionId, preset)
    })
  }

  /**
   * The policy facts a prompt owner can quote, published as the `toolFamilies` service.
   *
   * WHY THIS IS A SERVICE AND NOT A LITERAL IN THE CONSUMER. A prompt that says "you have no
   * `bash`" is a claim about the POLICY, and the policy lives here; the same prompt is read by
   * a root whose preset this row does not describe, where the claim is false (measured
   * 2026-11-17: a `cordis` root carried `bash` among 109 tools while the orchestrator policy
   * still said it had none). The consumer also needs the actual set: `removed` is the patterns
   * that really took tools out of this agent's view, not the configured list, so a pattern that
   * matched nothing (a Windows-only `pwsh` on Linux, a bridge that is down) is never quoted.
   *
   * The service is OPTIONAL for a consumer: `ctx.get('toolFamilies')` returns undefined in a
   * composition without this row, and the consumer must then assert nothing rather than guess.
   */
  const service = {
    /** The preset in force for a session, resolved exactly as the restriction is. */
    presetFor(session) {
      return resolvePreset({ session })
    },
    /**
     * Whether this agent's preset admits `name` at all — the registration-time half of the
     * policy.
     *
     * `tools.restrict` masks only global and ancestor registrations; a tool registered into the
     * agent's OWN layer (every kit plugin that registers on `agent/created`) stays visible to
     * every restriction. Those plugins therefore ask this before registering. A preset with no
     * row (standard, cordis, ptc, unknown) admits everything, exactly like `decide`.
     *
     * @returns true when the tool may be registered, false when the preset's row excludes it.
     */
    allows(agent, name) {
      if (resolved.disabled) return true
      if (typeof name !== 'string' || name === '') return true
      const preset = resolvePreset({ session: agent?.session })
      const entry = preset === undefined ? undefined : resolved.families[preset]
      if (entry === undefined) return true
      const cwd = agent?.session?.header?.cwd
      const hostHas = (marker) => {
        if (typeof cwd !== 'string' || cwd === '') return false
        try {
          return existsSync(join(cwd, marker))
        } catch {
          return false
        }
      }
      const denied = (entry.deny ?? []).some((pattern) => matches(name, pattern))
      if (denied) return false
      const projectDenied = (entry.projectDeny ?? []).some((pattern) => {
        if (!matches(name, pattern)) return false
        const marker = resolved.projectMarkers[pattern]
        return marker === undefined || !hostHas(marker)
      })
      if (projectDenied) return false
      const allow = Array.isArray(entry.allow) ? entry.allow : []
      return allow.length === 0 ? true : allow.some((pattern) => matches(name, pattern))
    },
    /**
     * What this policy removed from one agent's view.
     *
     * @returns `{ preset, removed, kept }` once a restriction is installed, `null` before that
     *   (or when the preset has no row): a consumer that gets `null` says nothing.
     */
    factsFor(agent) {
      const record = applied.get(agent)
      if (record === undefined) return null
      return { preset: record.preset, removed: [...record.removed], kept: [...record.keptProjectDeny] }
    },
  }
  try {
    const provided = ctx.provide?.('toolFamilies', service)
    if (typeof provided === 'function') ctx.effect?.(() => provided)
  } catch {
    // A context without service provisioning still restricts; it just publishes no facts.
  }

  /**
   * Install the short SDK section and the on-demand declaration tool for one agent.
   *
   * Only while the PTC executor owns this agent: its `sections` array is the registration
   * contract, so a native-executor preset pays nothing and gets no `sdk_api`. An agent-scoped
   * section shadows the preset's `tools:sdk`; an agent-scoped tool survives `tools.restrict`
   * by design, which is why the channel cannot be removed by a role's allow row.
   */
  const sdkSeats = new WeakMap()
  const syncSdk = (agent) => {
    if (agent === undefined || agent === null) return
    const current = sdkSeats.get(agent)
    let ptc = false
    try {
      const executor = agent.ctx?.tools?.selectExecutor?.(agent)
      ptc = Array.isArray(executor?.sections) && executor.sections.some((section) => section?.name === SDK_SECTION)
    } catch {
      ptc = false
    }
    if (!ptc) {
      if (current !== undefined) {
        try {
          current.disposeTool?.()
        } catch {
          // Disposal is best-effort; the next step re-reads the executor anyway.
        }
        try {
          current.disposeSection?.()
        } catch {
          // Same.
        }
        sdkSeats.delete(agent)
      }
      return
    }
    if (current !== undefined) return
    let disposeSection
    try {
      const order = agent.ctx?.systemPrompt?.getSectionOrder?.('TOOLS_SDK') ?? 5000
      disposeSection = agent.ctx.systemPrompt.section({
        name: SDK_SECTION,
        order,
        interpolate: false,
        // Recomputed each assembly from the agent's own visible set: a preset switch or a
        // restriction changes the module list, and a project without the godot marker never
        // sees an `mcp__godot__` module.
        text: () => {
          try {
            return sdkHeader(agent.ctx.tools.definitions(agent))
          } catch {
            return ''
          }
        },
      })
      const disposeTool = agent.ctx.tools.register(SDK_TOOL_DEFINITION)
      sdkSeats.set(agent, { disposeSection, disposeTool })
    } catch {
      try {
        disposeSection?.()
      } catch {
        // Same.
      }
      // Leaving the generated section in place is the safe failure: declarations stay visible.
    }
  }

  ctx.on('agent/created', ({ agent }) => {
    if (agent === undefined || agent === null) return
    applyTo(agent, 'created')
    syncSdk(agent)
    pending.delete(agent?.session?.id)
  })
  // The retry AND the recompute: `prepend` so it runs before any other contributor derives a
  // message, and before the request header of this step exists. It compares the agent's current
  // preset with the one in force, so a preset selected after creation is applied here.
  ctx.on('agent/pre-step', async (payload, next) => {
    const agent = payload?.agent
    if (agent !== undefined && agent !== null) {
      applyTo(agent, 'pre-step')
      syncSdk(agent)
    }
    return next()
  }, { prepend: true })
}

export default { name: '@cc/dsh-tool-families', inject: ['tools', 'systemPrompt'], apply }
