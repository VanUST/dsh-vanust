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
export const inject = ['tools']

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
 * @returns { deny, families, keptProjectGated, unmatched } — `deny` holds exact names only.
 */
export function decide(config, preset, { visible = [], hostHas = () => false } = {}) {
  if (config.disabled) return { deny: [], patterns: [], keptProjectDeny: [], unmatched: [] }
  const entry = preset === undefined || preset === null ? undefined : config.families[preset]
  if (entry === undefined) return { deny: [], patterns: [], keptProjectDeny: [], unmatched: [] }

  const denied = []
  const keptProjectDeny = []
  const unmatched = []
  const add = (pattern) => {
    const hits = visible.filter((name) => matches(name, pattern))
    if (hits.length === 0) unmatched.push(pattern)
    for (const name of hits) if (!denied.includes(name)) denied.push(name)
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
  return { deny: denied, patterns: [...(entry.deny ?? []), ...(entry.projectDeny ?? [])], keptProjectDeny, unmatched }
}

/** Schema bytes of the denied tools — the number that makes the saving reviewable. */
export function removedBytes(schemas = [], deny = []) {
  return schemas
    .filter((schema) => deny.includes(schema?.name))
    .reduce((total, schema) => total + JSON.stringify(schema).length, 0)
}

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
      const bytes = removedBytes(schemas, decision.deny)
      const entry = resolved.families[preset] ?? {}
      if (current !== undefined) lift(`preset changed to "${preset}"`)
      const dispose = tools.restrict({ deny: decision.deny, ...(entry.allow?.length ? { allow: entry.allow } : {}) })
      applied.set(agent, { preset, dispose: typeof dispose === 'function' ? dispose : undefined })
      ctx.logger?.info?.(
        `tool-families: preset "${preset}" denied ${decision.deny.length} tool(s) (${bytes} B of schema) via ${decision.patterns.join(', ')}`
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

  ctx.on('agent/created', ({ agent }) => {
    if (agent === undefined || agent === null) return
    applyTo(agent, 'created')
    pending.delete(agent?.session?.id)
  })
  // The retry AND the recompute: `prepend` so it runs before any other contributor derives a
  // message, and before the request header of this step exists. It compares the agent's current
  // preset with the one in force, so a preset selected after creation is applied here.
  ctx.on('agent/pre-step', async (payload, next) => {
    const agent = payload?.agent
    if (agent !== undefined && agent !== null) applyTo(agent, 'pre-step')
    return next()
  }, { prepend: true })
}

export default { name: '@cc/dsh-tool-families', inject: ['tools'], apply }
