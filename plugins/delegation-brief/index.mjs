/**
 * PURPOSE
 *   Two root-only tools that make a delegation brief a product of the register instead of prose:
 *     delegation_brief  — render the brief for a planned/accepted REQ (criteria verbatim, decisions,
 *                         mandatory tests with commands, non-scope, return format) and return its
 *                         text plus `briefHash`;
 *     delegation_return — validate a worker's structured return against the CURRENT brief:
 *                         `brief_stale` when the criteria changed, `return_unmapped` when the
 *                         return names a criterion the brief does not have.
 *
 * REFUSALS (design §7)
 *   cold_start_required  no project-state core, or the workspace has no state/views/index.json
 *   feature_required     the REQ does not exist, or is finished/rejected (not `proposed`, `open` or `accepted`)
 *   criteria_missing     the REQ has no acceptance criteria
 *
 * WHY THE PROMPT SECTION IS STATIC
 *   The root has to know the tools exist and that briefs are rendered, not written; anything
 *   that changes between turns belongs to the state feed, not to the system prompt.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { parseReturn, renderBrief, briefableReq, BRIEFABLE_REQ_STATUSES } from './lib/brief.mjs'

export const name = '@cc/dsh-delegation-brief'
/** Tools are registered per agent; no host-global service. */
export const inject = []

export const SECTION = [
  'DELEGATION BRIEF (deployment):',
  '  Briefs are RENDERED from the state register, not composed in prose. Call `delegation_brief` with the REQ id:',
  '  it returns the brief text and its briefHash, with the REQ and its acceptance criteria verbatim, the related',
  '  decisions, the tests that must pass with their commands, the non-scope and the return format. Refusals:',
  '  cold_start_required (no state register), feature_required (no such REQ or not accepted), criteria_missing.',
  '  The worker returns through `delegation_return` with that briefHash, {status: done|blocked|design_problem,',
  '  criteria:[{id,pass,evidence}], questions:[]}. brief_stale means a criterion changed after the brief;',
  '  return_unmapped means the return names a criterion the brief does not have. Never invent a criterion id.',
].join('\n')

/** The preset in force, resolved through the policy owner when it is mounted. */
/** The role-surface policy; a preset without a tool-families row admits every tool. */
function surfaceAllows(ctx, agent, name) {
  try {
    return ctx.get?.('toolFamilies')?.allows?.(agent, name) !== false
  } catch {
    return true
  }
}

function presetOf(ctx, agent) {
  try {
    const resolved = ctx.get?.('toolFamilies')?.presetFor?.(agent?.session)
    if (typeof resolved === 'string' && resolved !== '') return resolved
  } catch {
    // No policy owner: fall back to the creation header.
  }
  try {
    const header = agent?.session?.header?.agentPreset
    return typeof header === 'string' && header !== '' ? header : undefined
  } catch {
    return undefined
  }
}

const out = () => ({ schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] })
const cwdOf = (agent) => agent?.session?.header?.cwd ?? process.cwd()
const coreOf = (ctx) => {
  try {
    return ctx.get?.('ccProjectState')
  } catch {
    return undefined
  }
}
const refuse = (code, message, extra = {}) => ({ ok: false, code, message, ...extra })

/** Read the register the brief needs, or a named refusal. */
async function loadBrief(core, { cwd, reqId, role, nonScope }) {
  if (core === undefined || core === null) return refuse('cold_start_required', 'the project state core is not mounted (ccProjectState); the brief cannot be rendered')
  if (!existsSync(join(cwd, 'state', 'views', 'index.json'))) return refuse('cold_start_required', `no state register in ${cwd}/state; record requirements first`)
  const state = typeof core.open === 'function' ? core.open(cwd) : core
  const reqRecord = await state.get(reqId)
  if (reqRecord?.ok === false) return refuse('feature_required', `REQ ${reqId} is not in the register: ${reqRecord.message ?? reqRecord.code}`)
  const req = reqRecord.frontmatter
  if (!briefableReq(req.status)) return refuse('feature_required', `REQ ${reqId} is "${req.status}"; a brief is rendered for a planned or accepted requirement (${BRIEFABLE_REQ_STATUSES.join(', ')}), not for a finished or rejected one`)
  const decisions = []
  const decisionRows = (await state.list('decision'))?.rows ?? []
  for (const row of decisionRows) {
    const record = await state.get(row.id)
    if (record?.ok === false) continue
    const links = Array.isArray(record.frontmatter?.links) ? record.frontmatter.links : []
    if (links.some((link) => link.id === reqId)) decisions.push(record.frontmatter)
  }
  const tests = []
  const testRows = (await state.list('test'))?.rows ?? []
  for (const row of testRows) {
    if (row.reqId !== reqId) continue
    const record = await state.get(row.id)
    if (record?.ok === false) continue
    tests.push(record.frontmatter)
  }
  return { ok: true, req, decisions, tests }
}

/**
 * Register the tools and the static section on a root session of the orchestrator preset.
 *
 * @param ctx - host context.
 * @param {object} [config] - `disabled: true` turns the row off.
 */
export function apply(ctx, config = {}) {
  if (config.disabled === true) return

  const briefTool = defineTool({
    name: 'delegation_brief',
    description: 'Render the delegation brief for an accepted REQ from the project state register. Returns the brief text and its briefHash; the REQ and its acceptance criteria are verbatim, the related decisions and the tests that must pass (with commands) are included, and the return format is spelled out. Deterministic: the same request and the same state give the same bytes. Refusals: cold_start_required (no state register), feature_required (no such REQ or not accepted), criteria_missing (the REQ has no criteria).',
    parameters: {
      reqId: { type: 'string', required: true, description: 'The REQ to brief (REQ-001).' },
      role: { type: 'string', description: 'Optional role label the brief is addressed to (BACKEND, REVIEWER, …).' },
      nonScope: { type: 'array', items: { type: 'string' }, description: 'What the worker must not touch, rendered verbatim.' },
    },
    output: out(),
    async execute(args, exec) {
      try {
        const cwd = cwdOf(exec.agent)
        const loaded = await loadBrief(coreOf(ctx), { cwd, reqId: args.reqId, role: args.role, nonScope: args.nonScope })
        if (loaded.ok === false) return loaded
        const rendered = renderBrief({ req: loaded.req, decisions: loaded.decisions, tests: loaded.tests, nonScope: args.nonScope ?? [], role: args.role ?? '' })
        if (rendered.ok === false) return rendered
        return { ok: true, reqId: loaded.req.id, briefHash: rendered.briefHash, criteria: rendered.criteria, text: rendered.text }
      } catch (error) {
        return refuse('brief_failed', error instanceof Error ? error.message : String(error))
      }
    },
  })

  const returnTool = defineTool({
    name: 'delegation_return',
    description: 'Validate a worker\'s structured return against the brief it answers. Pass the same reqId/role/nonScope and the briefHash the brief returned, plus {status: done|blocked|design_problem, criteria:[{id,pass,evidence}], questions:[]}. Refuses brief_stale when a criterion changed since the brief (rerender it) and return_unmapped when the return names a criterion the brief does not have or omits one.',
    parameters: {
      reqId: { type: 'string', required: true, description: 'The REQ the brief was rendered for.' },
      briefHash: { type: 'string', required: true, description: 'The briefHash returned by delegation_brief.' },
      role: { type: 'string' },
      nonScope: { type: 'array', items: { type: 'string' } },
      returned: { type: 'object', required: true, additionalProperties: true, description: '{status, criteria:[{id,pass,evidence}], questions:[]}' },
    },
    output: out(),
    async execute(args, exec) {
      try {
        const cwd = cwdOf(exec.agent)
        const loaded = await loadBrief(coreOf(ctx), { cwd, reqId: args.reqId, role: args.role, nonScope: args.nonScope })
        if (loaded.ok === false) return loaded
        const rendered = renderBrief({ req: loaded.req, decisions: loaded.decisions, tests: loaded.tests, nonScope: args.nonScope ?? [], role: args.role ?? '' })
        if (rendered.ok === false) return rendered
        const parsed = parseReturn({ brief: rendered, briefHash: String(args.briefHash ?? ''), returned: args.returned })
        if (parsed.ok === false) return parsed
        return { ok: true, reqId: loaded.req.id, ...parsed }
      } catch (error) {
        return refuse('return_failed', error instanceof Error ? error.message : String(error))
      }
    },
  })

  // STRICT PRESET GATE (owner decision D8): only a session whose preset in force is
  // `orchestrator` gets the tools and the section. A session without a named preset has no
  // policy owner, so it gets nothing — the same rule as the other gated plugins. The gate
  // follows the SEAT: a preset picked on a blank session is committed as
  // `agent-preset/selected` after the agent exists, so a creation-time check would leave an
  // `architect` chat holding two tools and a 784 B section its allow row does not admit.
  const installed = new WeakMap()
  const sync = (agent, presetOverride) => {
    if (agent === undefined || agent === null) return
    let preset
    try {
      preset = typeof presetOverride === 'string' && presetOverride !== '' ? presetOverride : (presetOf(ctx, agent) ?? '(none)')
    } catch {
      preset = '(none)'
    }
    const current = installed.get(agent)
    if (current !== undefined && current.preset === preset) return
    if (current !== undefined) {
      for (const dispose of current.disposers) {
        try {
          dispose()
        } catch {
          // A failing disposer must not take the session down.
        }
      }
      installed.delete(agent)
    }
    if (preset !== 'orchestrator') return
    try {
      const disposers = []
      if (surfaceAllows(ctx, agent, briefTool.name)) {
        const dispose = agent.ctx.tools.register(briefTool)
        if (typeof dispose === 'function') disposers.push(dispose)
      }
      if (surfaceAllows(ctx, agent, returnTool.name)) {
        const dispose = agent.ctx.tools.register(returnTool)
        if (typeof dispose === 'function') disposers.push(dispose)
      }
      if (typeof agent?.ctx?.systemPrompt?.section === 'function') {
        const dispose = agent.ctx.systemPrompt.section({ name: 'deployment:delegation-brief', order: 122, text: SECTION })
        if (typeof dispose === 'function') disposers.push(dispose)
      }
      installed.set(agent, { preset, disposers })
    } catch {
      // A section or a registration that fails must not break the session.
    }
  }
  ctx.on('agent/created', ({ agent }) => sync(agent))
  ctx.on('agent/pre-step', (payload, next) => {
    sync(payload?.agent)
    return next()
  }, { prepend: true })
  try {
    ctx.root?.on?.('session/event', (session, event) => {
      if (event?.type !== 'agent-preset/selected') return
      let live
      try {
        live = ctx.get?.('agents')?.get?.(session?.id)
      } catch {
        live = undefined
      }
      sync(live, event?.data?.agentPreset)
    })
  } catch {
    // A root without the session feed still re-syncs at pre-step.
  }
}

export default { name, inject, apply, SECTION }
