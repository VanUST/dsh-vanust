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
 *   One `agent/created` listener. For a preset with an effective policy it calls
 *   `agent.ctx.tools.restrict({ deny })` ONCE, before the first request header exists, and
 *   logs the preset, the denied families, the removed tool count and the schema bytes that
 *   leave the prefix. No tool, no prompt section, no session event.
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
  /** Agents already offered the restriction, so the deferred attempt runs once each. */
  const settled = new WeakSet()

  /**
   * Apply the preset's deny list to one agent, once.
   *
   * ORDERING IS THE WHOLE PROBLEM. The bridge registers MCP tools on the host plane, and the
   * agent's visible set is derived when a request is built. An `agent/created` call is the
   * earliest moment, but it is not guaranteed to be AFTER the bridge populated the global layer
   * (and `tools.restrict` validates every name against `restrictableNames`, so an unknown name
   * throws instead of being ignored). This runs at `agent/created` and, when that produced
   * nothing (no visible names, or names still unknown), again on the first `agent/pre-step`
   * — still before the request header is derived for that step.
   *
   * @returns true when a restriction was installed (or the agent is out of policy).
   */
  const applyTo = (agent, when) => {
    if (settled.has(agent)) return true
    const preset = agent?.session?.header?.agentPreset
    const cwd = agent?.session?.header?.cwd
    const tools = agent?.ctx?.tools
    if (typeof tools?.restrict !== 'function') {
      if (debug) console.error(`tool-families[debug:${when}]: no agent-scoped tools.restrict (preset=${preset})`)
      return false
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
      if (resolved.families[preset] === undefined) {
        settled.add(agent)
        return true
      }
      if (decision.deny.length === 0 && decision.unmatched.length > 0) return false
      if (decision.deny.length === 0) {
        if (decision.keptProjectDeny.length > 0) {
          ctx.logger?.info?.(`tool-families: preset "${preset}" keeps ${decision.keptProjectDeny.join(', ')} (project marker present in ${cwd})`)
        }
        settled.add(agent)
        return true
      }
      const bytes = removedBytes(schemas, decision.deny)
      const entry = resolved.families[preset] ?? {}
      tools.restrict({ deny: decision.deny, ...(entry.allow?.length ? { allow: entry.allow } : {}) })
      settled.add(agent)
      ctx.logger?.info?.(
        `tool-families: preset "${preset}" denied ${decision.deny.length} tool(s) (${bytes} B of schema) via ${decision.patterns.join(', ')}`
          + `${decision.keptProjectDeny.length > 0 ? `; kept ${decision.keptProjectDeny.join(', ')}` : ''}`
          + `${decision.unmatched.length > 0 ? `; unmatched ${decision.unmatched.join(', ')}` : ''}`,
      )
      if (debug) console.error(`tool-families[debug:${when}]: applied ${decision.deny.length} deny name(s)`)
      return true
    } catch (error) {
      // Reported, never thrown: a boot that cannot restrict still works, it just pays more.
      // The console line is deliberate: a `ctx.logger` warning does not reach the process
      // stdout that an operator reads while proving a change on a second server.
      console.error(`tool-families: ${when} could not restrict preset "${preset ?? 'none'}": ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  ctx.on('agent/created', ({ agent }) => {
    if (agent === undefined || agent === null) return
    applyTo(agent, 'created')
  })
  // The retry that makes the policy non-inert: `prepend` so it runs before any other contributor
  // derives a message, and before the request header of this step exists.
  ctx.on('agent/pre-step', async (payload, next) => {
    const agent = payload?.agent
    if (agent !== undefined && agent !== null && !settled.has(agent)) applyTo(agent, 'pre-step')
    return next()
  }, { prepend: true })
}

export default { name: '@cc/dsh-tool-families', inject: ['tools'], apply }
