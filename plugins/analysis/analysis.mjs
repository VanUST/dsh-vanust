/**
 * PURPOSE
 *   Analysis before decomposition: one repo-tracked Analysis Record per initiative, four
 *   root-only tools over it, and a short root policy. The record keeps the business outcome
 *   separate from the requested solution and traces every requirement through its process,
 *   component, task and evidence. The taskboard stays a lifecycle ledger; the design map is a
 *   drawing the record may name in prose, and nothing in the record reads it.
 *
 * INPUTS
 *   Config (all optional):
 *     dir            record directory relative to the session workspace. Default 'docs/analysis'.
 *     promptSection  false turns the short root policy off. Default true.
 *
 * OUTPUTS
 *   A `analysis` service (ctx.provide) used by the orchestrator's delegation gate, and four
 *   tools registered ONLY on root agents: analysis_read, analysis_upsert, analysis_check,
 *   analysis_impact. A root agent also gets a short `deployment:analysis-policy` section.
 *   A delegated child receives no analysis tool: the record is the root's responsibility.
 *
 * KEYWORDS
 *   analysis, analysis record, analysis_required, analysis_stale, L0/L1/L2, traceability,
 *   requirement, process, component, task, evidence
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The plugin provides its service even when mounted without the orchestrator; the
 *     orchestrator reads it through ctx.get('analysis') and stays inert when it is absent,
 *     so a composition without this row keeps the legacy delegation behaviour.
 *   - Registration is scoped per agent on `agent/created`; a child is not offered the tools
 *     and cannot be argued into them by a brief.
 *   - A refusal from the store is returned as a canonical JSON value, never turned into a
 *     thrown error the model has to parse out of prose.
 *   - The prompt section is a function of static text only; it does not read the record, so
 *     it cannot churn the provider's cached prefix mid-turn.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { createService } from './store.mjs'
import { mirror, precheck, precheckEvidence } from './mirror.mjs'

/**
 * Whether this agent's preset admits one tool name.
 *
 * The policy owner (`toolFamilies`) answers; a composition without that row admits everything,
 * exactly like `tools.restrict` does. A missing service must never remove a tool silently.
 *
 * @param ctx - Cordis context.
 * @param agent - The agent the tool would be registered on.
 * @param name - Tool name.
 * @returns false only when the policy positively excludes the name.
 */
/**
 * The preset in force for one agent, resolved through the policy owner first.
 *
 * A selection made after the agent was created is committed as `agent-preset/selected`, and the
 * policy owner (`toolFamilies.presetFor`) resolves it; the creation header is the last fallback.
 *
 * @param ctx - Cordis context.
 * @param agent - The agent being synced.
 * @returns The preset id, or undefined in a composition without a preset.
 */
function presetOf(ctx, agent) {
  try {
    const resolved = ctx.get?.('toolFamilies')?.presetFor?.(agent?.session)
    if (typeof resolved === 'string' && resolved !== '') return resolved
  } catch {
    // No policy owner: fall through to the creation header.
  }
  try {
    const projected = ctx.get?.('agentPresets')?.presetForSession?.(agent?.session)
    if (typeof projected === 'string' && projected !== '') return projected
  } catch {
    // No projection either.
  }
  const header = agent?.session?.header?.agentPreset
  return typeof header === 'string' && header !== '' ? header : undefined
}

function surfaceAllows(ctx, agent, name) {
  try {
    return ctx.get?.('toolFamilies')?.allows?.(agent, name) !== false
  } catch {
    return true
  }
}

/**
 * The role's Analysis surface: the tools its allow row admits, and the policy section only when
 * at least one of them is registered.
 *
 * WHY IT FOLLOWS THE SEAT. A seat picked on a blank session is committed as an
 * `agent-preset/selected` event AFTER `agent/created`, so a plugin that registers once keeps the
 * creation-time answer: measured 2026-11-19, a new `architect` chat (created as `orchestrator`,
 * seat chosen before the first message) shipped analysis_* tools and 6 641 B of policy into a
 * role whose allow row has none of them. The gate therefore re-syncs on the seat, disposing the
 * previous set first — a duplicate registration would throw.
 *
 * @param ctx - Cordis context.
 * @param agent - Agent whose surface is synced.
 * @param tools - The four Analysis tools (name-carrying definitions).
 * @param config - Plugin config; `promptSection: false` turns the section off.
 * @param cache - WeakMap from agent to what is installed, owned by apply().
 */
function syncRoleSurfaceFor(ctx, tools, config, cache) {
  return (agent, presetOverride) => {
    if (agent === undefined || agent === null) return
    let preset
    try {
      preset = ctx.get?.('toolFamilies')?.presetFor?.(agent?.session)
    } catch {
      preset = undefined
    }
    // A composition without a preset owner (a bare assembly, a test harness) admits everything:
    // the sentinel keeps the cache stable and the filter below then admits every tool.
    if (typeof preset !== 'string' || preset === '') preset = agent?.session?.header?.agentPreset
    if (typeof preset !== 'string' || preset === '') preset = typeof presetOverride === 'string' && presetOverride !== '' ? presetOverride : '(none)'
    const current = cache.get(agent)
    if (current !== undefined && current.preset === preset) return
    if (current !== undefined) {
      for (const dispose of current.disposers) {
        try {
          dispose()
        } catch {
          // A failing disposer must not take the session down.
        }
      }
      cache.delete(agent)
    }
    // THE ROLE'S SURFACE DECIDES, NOT THE FACT THAT THIS IS A ROOT (D-4, codex-context-bounds):
    // a tool this preset does not admit is not registered in the agent's own layer either, where
    // `tools.restrict` could never mask it again.
    const offered = tools.filter((tool) => surfaceAllows(ctx, agent, tool.name))
    const disposers = offered.map((tool) => {
      try {
        return agent.ctx.tools.register(tool)
      } catch {
        return undefined
      }
    }).filter((dispose) => typeof dispose === 'function')
    let disposeSection
    if (offered.length > 0 && config.promptSection !== false) {
      // THE SECTION DESCRIBES THE TOOLS, SO A ROLE WITHOUT THEM MUST NOT PAY FOR IT. Measured
      // 2026-11-19: 6 641 B of "Analysis before decomposition" sat in the system prompt of every
      // root of every preset, including roles whose allow row has no analysis_* tool at all.
      try {
        let order = 123
        try {
          const base = agent.ctx.systemPrompt.getSectionOrder('SUBAGENT_DELEGATION')
          if (Number.isFinite(base)) order = base + 2
        } catch {
          // A prompt registry that cannot report an order still accepts an explicit one.
        }
        disposeSection = agent.ctx.systemPrompt.section({ name: 'deployment:analysis-policy', order, text: ANALYSIS_POLICY })
      } catch {
        // The tools are the enforcement; a section that cannot register must not break the agent.
      }
    }
    cache.set(agent, { preset, disposers: disposeSection === undefined ? disposers : [...disposers, disposeSection] })
  }
}

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'analysis'

/**
 * Whether this agent's preset admits one tool name.
 *
 * The policy owner (`toolFamilies`) answers; a composition without that row admits everything,
 * exactly like `tools.restrict` does. A missing service must never remove a tool silently.
 *
 * @param ctx - Cordis context.
 * @param agent - The agent the tool would be registered on.
 * @param name - Tool name.
 * @returns false only when the policy positively excludes the name.
 */
/** The tool and prompt registries are required; the store needs nothing else. */
export const inject = ['tools', 'systemPrompt']

/**
 * Whether this agent is the ROOT of its session tree.
 *
 * Same lineage rule the taskboard and the orchestrator use: depth > 0, a `parentSession`
 * header or `origin: 'subagent'` all mean CHILD. Duplicated here rather than imported from
 * the orchestrator so the analysis plugin has no load-order dependency on it.
 *
 * @param agent - The agent a session was created for.
 * @returns True for a root session.
 */
export function isRootAgent(agent) {
  const header = agent?.session?.header
  const depth = Number(header?.delegationDepth ?? 0)
  if (Number.isFinite(depth) && depth > 0) return false
  if (typeof header?.parentSession === 'string' && header.parentSession !== '') return false
  if (header?.origin === 'subagent') return false
  return true
}

/** The short policy the root reads every turn. Static text: no record is read here. */
export const ANALYSIS_POLICY = `## Analysis before decomposition (deployment)

An **L0 local edit** is a local fix with no contract, architecture or data change - a typo, a copy change, a one-file correction inside an existing behaviour. Do it **inline**: no Analysis Record, no case per requirement, no delegation; the task record and the report are enough. When the change touches a contract, the architecture or the data, it is not L0: an L1/L2 change starts with ONE Analysis Record in \`docs/analysis/<initiative>.json\` before you create or delegate tasks. A question needs no change at all.

- \`analysis_upsert\` records the business outcome (separate from the requested solution), the process, BR/FR/NFR with acceptance, architecture and data ownership, contract impact, invariants, decisions, open questions and a trace row per requirement. Every edit of an existing record needs the \`expectedRev\` it read.
- \`analysis_check\` must pass before the record can be \`ready\`. It names missing acceptance, missing component/data ownership, missing contract impact and an unresolved trace; it also reports completion as proven vs explicitly deferred.
- \`delegate_task\` for L1/L2 needs \`changeClass\`, \`analysisId\` and the \`requirementIds\` it implements. A missing/unready record is refused \`analysis_required\`; an affected record is refused \`analysis_stale\`. L0 passes without a record. Read-only RESEARCH/CONTEXT/REVIEWER/CRITIC work and a legacy \`taskId\` attach (no changeClass/analysisId) are exempt.
- When a requirement, architecture or contract changes mid-work, \`analysis_upsert\` records a pending impact and reopens the record. Update it, pass \`resolveImpacts\`, and re-check before delegating again. Adding or removing a requirement also counts; a requirement with traced tasks cannot be removed — mark it rejected or deferred with a reason.
- \`task_close\` is refused while a task traced in the record points at a planned requirement, or at a proven requirement without task evidence. \`update_goal action:"complete"\` is refused while a record that names that \`goalId\` is not completed.
- Finish with every requirement proven with a task and its evidence, or explicitly deferred with a reason.`

function workingDir(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd()
}

/** Turn a thrown store error into the canonical refusal value. */
function refused(error) {
  if (error !== null && typeof error === 'object' && typeof error.code === 'string') {
    return { ok: false, code: error.code, message: error.message, ...(error.details ?? {}) }
  }
  throw error
}

/**
 * Register the store, the root policy and the four root-only tools.
 *
 * @param ctx - Cordis context.
 * @param config - Raw plugin config.
 */
export function apply(ctx, config = {}) {
  const service = createService({
    dir: config.dir,
    historyLimit: config.historyLimit,
  }, ctx.logger)
  const provided = ctx.provide('analysis', service)
  ctx.effect(() => provided)
  // The project state core is OPTIONAL: a composition without project-state keeps the old
  // analysis behaviour (no mirroring, no duplicate gate).
  const coreOf = () => {
    try {
      return ctx.get?.('ccProjectState')
    } catch {
      return undefined
    }
  }

  const out = () => ({
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  })

  const readTool = defineTool({
    name: 'analysis_read',
    description: 'Read one Analysis Record from docs/analysis/<initiative>.json, or list the records when initiative is omitted. Returns the revision, status, semantic fingerprint and whether it still matches (with the recognised legacy version when the stored hash is an earlier algorithm), ambiguousOwnership when legacy data ownership needs resolution, the completeness check and the proven/deferred completion summary. Call it before reusing an analysis in a new chat: the file, not the conversation, is the state.',
    parameters: {
      initiative: { type: 'string', description: 'Initiative id (kebab-case, e.g. "analysis-before-decomposition"). Omit to list every record with its status and staleness.' },
    },
    output: out(),
    execute(args, exec) {
      try {
        const cwd = workingDir(exec.agent)
        return args.initiative === undefined || args.initiative === ''
          ? service.list(cwd)
          : service.read(cwd, { initiative: args.initiative })
      } catch (error) {
        return refused(error)
      }
    },
  })

  const upsertTool = defineTool({
    name: 'analysis_upsert',
    description: 'Create or edit one Analysis Record with compare-and-set. The patch may carry title, requestedSolution, businessOutcome, process, requirements [{id,kind,text,acceptance,status,reason}], architecture, data, decisions, contracts, trace and links. An unknown key is invalid_record and nothing is written. With the project-state core, requirements mirror into REQ (criteria + criteriaHash) and a proven requirement needs a TEST with a red→green pair (evidence_required).',
    parameters: {
      initiative: { type: 'string', required: true, description: 'Initiative id; also the file name in docs/analysis/.' },
      expectedRev: { type: 'integer', description: 'The revision you read. Required for an existing record; omit or 0 for a new one.' },
      patch: { type: 'object', additionalProperties: true, description: 'Fields to create or replace. Arrays replace; businessOutcome/process/architecture/sizing/designRef merge one level.' },
      resolveImpacts: { type: 'json', description: "Optional: 'all' or an array of pending impact ids to resolve after updating the record." },
      acceptHandEdit: { type: 'boolean', description: 'Acknowledge a semantic fingerprint mismatch caused by editing the file outside analysis_upsert. Without this every write to a hand-edited record is refused.' },
      waiver: { type: 'object', additionalProperties: false, description: 'Explicit waiver of evidence_required: {reason, by: "human"}; written to the state journal.', properties: { reason: { type: 'string' }, by: { type: 'string' } } },
      allowDuplicate: { type: 'boolean', description: 'With project-state mounted, every requirement is mirrored into a REQ. A new requirement that looks like an existing REQ is refused with req_duplicate_candidates until this is true AND duplicateReview carries the reason for accepting the duplicate.' },
      duplicateReview: { type: 'string', description: 'The reason the duplicate candidates were reviewed and the new requirement is still distinct (required with allowDuplicate:true).' },
      by: { type: 'string', enum: ['agent', 'human'], description: 'Author recorded on the revision. Default agent.' },
    },
    output: out(),
    async execute(args, exec) {
      try {
        const cwd = workingDir(exec.agent)
        const core = coreOf()
        const patchRequirements = Array.isArray(args.patch?.requirements) ? args.patch.requirements : []
        const gate = await precheck(core, {
          cwd,
          initiative: args.initiative,
          requirements: patchRequirements,
          allowDuplicate: args.allowDuplicate === true,
          duplicateReview: args.duplicateReview,
        })
        if (gate.ok === false) return gate
        // FR11: a requirement marked proven needs a TEST with a passed red→green pair; the
        // record is not written when that evidence is missing (the REQ keeps its status).
        const evidence = await precheckEvidence(core, { cwd, initiative: args.initiative, requirements: patchRequirements })
        if (evidence.ok === false) {
          // FR8: an explicit waiver is the only way past the evidence gate, and it is recorded.
          if (args.waiver === undefined) return evidence
          if (args.waiver === null || typeof args.waiver !== 'object' || typeof args.waiver.reason !== 'string' || args.waiver.reason.trim() === '' || args.waiver.by !== 'human') {
            return { ok: false, code: 'waiver_required', message: 'evidence_required is waived only with {reason, by: "human"}; both fields are required' }
          }
          const state = typeof core.open === 'function' ? core.open(cwd) : core
          if (typeof state.journal === 'function') await state.journal({ code: 'evidence_required', reason: String(args.waiver.reason).slice(0, 1000), by: 'human', initiative: args.initiative, requirementId: evidence.requirementId })
        }
        const result = service.upsert(cwd, {
          initiative: args.initiative,
          expectedRev: args.expectedRev,
          patch: args.patch,
          resolveImpacts: args.resolveImpacts,
          acceptHandEdit: args.acceptHandEdit === true,
          by: args.by,
        })
        if (result?.ok === false || core === undefined || core === null) return result
        // Mirror AFTER the record is safely on disk: the record is the justification, the REQ
        // register is derived from it; a mirror failure is reported, never rolled back into a
        // lost analysis write.
        const mirrored = await mirror(core, { cwd, initiative: args.initiative, record: result.record })
        // THE MODEL'S COPY IS A SUMMARY, NOT THE RECORD. The full record is 10-15 KB per call
        // and the caller just wrote it; what it needs back is the revision, the verdicts and
        // the REQ mirror. `analysis_read` returns the record when a caller really needs it.
        const record = result.record ?? null
        return {
          ok: result.ok === true,
          created: result.created === true,
          rev: result.rev,
          status: record?.status ?? result.status,
          title: record?.title,
          counts: {
            requirements: Array.isArray(record?.requirements) ? record.requirements.length : 0,
            trace: Array.isArray(record?.trace) ? record.trace.length : 0,
            decisions: Array.isArray(record?.decisions) ? record.decisions.length : 0,
            components: Array.isArray(record?.architecture?.components) ? record.architecture.components.length : 0,
          },
          readiness: result.readiness,
          check: result.check,
          completion: result.completion,
          pendingImpacts: Array.isArray(record?.pendingImpacts) ? record.pendingImpacts.map((impact) => ({ id: impact.id, change: impact.change })) : [],
          reqMirror: mirrored,
          recordHint: 'call analysis_read for the full record',
        }
      } catch (error) {
        return refused(error)
      }
    },
  })

  const checkTool = defineTool({
    name: 'analysis_check',
    description: 'Run the completeness checker over one Analysis Record: readiness (missing business outcome, solution, process, acceptance, ownership, contract impact, trace) apart from completion (requirements without tasks or evidence). Read-only; returns findings with paths.',
    parameters: {
      initiative: { type: 'string', required: true, description: 'Initiative id to check.' },
      forCompletion: { type: 'boolean', description: 'Also enforce the completion gate: every requirement proven with evidence or explicitly deferred/rejected.' },
    },
    output: out(),
    execute(args, exec) {
      try {
        return service.check(workingDir(exec.agent), { initiative: args.initiative, forCompletion: args.forCompletion === true })
      } catch (error) {
        return refused(error)
      }
    },
  })

  const impactTool = defineTool({
    name: 'analysis_impact',
    description: 'Record that a requirement, component, contract, data item or invariant changed, and return what the change affects: requirement ids, process ids, component ids, contract/data ids and the task ids already traced to them. It reopens the record as draft and records a pending impact, so the next L1/L2 delegation is refused analysis_stale until the record is updated and resolveImpacts clears it. Call this before continuing after any mid-work change.',
    parameters: {
      initiative: { type: 'string', required: true, description: 'Initiative id whose analysis must absorb the change.' },
      expectedRev: { type: 'integer', required: true, description: 'The revision you read; a stale one is refused.' },
      change: { type: 'string', required: true, description: 'One sentence naming what changed.' },
      requirementId: { type: 'string', description: 'The requirement that changed, when the change is requirement-level.' },
      kind: { type: 'string', enum: ['requirement', 'process', 'component', 'contract', 'data', 'invariant', 'architecture', 'design'], description: 'What kind of thing changed. Default requirement.' },
      targetId: { type: 'string', description: 'The component/contract/data/invariant id that changed, when the change is not requirement-level.' },
    },
    output: out(),
    execute(args, exec) {
      try {
        return service.impact(workingDir(exec.agent), {
          initiative: args.initiative,
          expectedRev: args.expectedRev,
          change: args.change,
          requirementId: args.requirementId,
          kind: args.kind,
          targetId: args.targetId,
        })
      } catch (error) {
        return refused(error)
      }
    },
  })

  const tools = [readTool, upsertTool, checkTool, impactTool]
  const roleSurfaces = new WeakMap()
  const syncRoleSurface = syncRoleSurfaceFor(ctx, tools, config, roleSurfaces)
  ctx.on('agent/created', ({ agent }) => {
    // COMPLETION GUARDS RUN FOR EVERY AGENT. A task_close or a goal completion is a
    // lifecycle action, not a root tool: a child must not be able to close traced work
    // either. The guard is monotonic (tools.guard), so no later listener can re-allow it.
    agent.ctx.tools.guard((exec) => {
      if (exec === null || exec === undefined) return undefined
      const args = exec.arguments !== null && typeof exec.arguments === 'object' ? exec.arguments : {}
      const cwd = workingDir(exec.agent ?? agent)
      try {
        if (exec.name === 'task_close') {
          const ids = []
          if (typeof args.id === 'string' && args.id !== '') ids.push(args.id)
          if (Array.isArray(args.ids)) for (const id of args.ids) if (typeof id === 'string' && id !== '') ids.push(id)
          let taskboard
          try { taskboard = ctx.get('taskboard') } catch { taskboard = undefined }
          const statusOf = (taskId) => {
            try { return taskboard?.get?.(cwd, taskId)?.status } catch { return undefined }
          }
          const isOpenTask = (taskId) => {
            const status = statusOf(taskId)
            return status !== 'done' && status !== 'cancelled'
          }
          for (const id of ids) {
            const status = statusOf(id)
            if (status === 'done' || status === 'cancelled') continue
            const refusal = service.taskCloseRefusal(cwd, id, { isOpenTask, closingIds: ids })
            if (refusal.ok !== true) return `analysis: ${refusal.message}`
          }
        }
        if (exec.name === 'update_goal' && (args.action === 'complete' || args.status === 'complete')) {
          const refusal = service.goalRefusal(cwd, typeof args.goal_id === 'string' ? args.goal_id : '')
          if (refusal.ok !== true) return `analysis: ${refusal.message}`
        }
      } catch (error) {
        return `analysis: could not verify the Analysis Record for ${exec.name} (${error instanceof Error ? error.message : String(error)}); retry before completing`
      }
      return undefined
    })
    if (!isRootAgent(agent)) return
    syncRoleSurface(agent)
  })

  ctx.on('agent/pre-step', (payload, next) => {
    // THE LAST LINE OF DEFENCE. A seat picked on a blank session is committed as
    // `agent-preset/selected` after the agent exists, and the first request header is derived
    // after pre-step: this is the last point where the surface can still follow the seat.
    syncRoleSurface(payload?.agent)
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
      syncRoleSurface(live, event?.data?.agentPreset)
    })
  } catch {
    // A root without the session feed still re-syncs at pre-step.
  }
}

export { createService }
