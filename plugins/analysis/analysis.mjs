/**
 * PURPOSE
 *   Analysis before decomposition: one repo-tracked Analysis Record per initiative, four
 *   root-only tools over it, and a short root policy. The record keeps the business outcome
 *   separate from the requested solution and traces every requirement through its process,
 *   component, task and evidence. The taskboard stays a lifecycle ledger and the design map
 *   stays a scene; `designRef.mapRev` is the only link between them.
 *
 * INPUTS
 *   Config (all optional):
 *     dir            record directory relative to the session workspace. Default 'docs/analysis'.
 *     designMapFile  design-map scene relative to the workspace. Default 'design.excalidraw'.
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
 *   requirement, process, component, task, evidence, designMapRev
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

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'analysis'

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

An L1/L2 change starts with ONE Analysis Record in \`docs/analysis/<initiative>.json\` before you create or delegate tasks. An L0 question or a local fix needs none.

- \`analysis_upsert\` records the business outcome (separate from the requested solution), the process, BR/FR/NFR with acceptance, architecture and data ownership, contract impact, invariants, decisions, open questions and a trace row per requirement. Every edit of an existing record needs the \`expectedRev\` it read.
- \`analysis_check\` must pass before the record can be \`ready\`. It names missing acceptance, missing component/data ownership, missing contract impact, a moved design map and an unresolved trace; it also reports completion as proven vs explicitly deferred.
- \`delegate_task\` for L1/L2 needs \`changeClass\`, \`analysisId\` and the \`requirementIds\` it implements. A missing/unready record is refused \`analysis_required\`; an affected record is refused \`analysis_stale\`. L0 passes without a record. Read-only RESEARCH/REVIEWER/CRITIC work and a legacy \`taskId\` attach (no changeClass/analysisId) are exempt.
- When a requirement, architecture, contract or the design map changes mid-work, \`analysis_upsert\` records a pending impact and reopens the record. Update it, pass \`resolveImpacts\`, and re-check before delegating again. Adding or removing a requirement also counts; a requirement with traced tasks cannot be removed — mark it rejected or deferred with a reason.
- \`task_close\` is refused while a task traced in the record points at a planned requirement, or at a proven requirement without task evidence. \`update_goal action:"complete"\` is refused while a record that names that \`goalId\` is not completed.
- Finish with every requirement proven with a task and its evidence, or explicitly deferred with a reason. The design map revision is captured as \`designRef\`. A bare \`designRef\` bump reopens the record rather than clearing drift.`

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
    designMapFile: config.designMapFile,
    historyLimit: config.historyLimit,
  }, ctx.logger)
  const provided = ctx.provide('analysis', service)
  ctx.effect(() => provided)

  const out = () => ({
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  })

  const readTool = defineTool({
    name: 'analysis_read',
    description: 'Read one Analysis Record from docs/analysis/<initiative>.json, or list the records when initiative is omitted. Returns the revision, status, semantic fingerprint and whether it still matches, the design-map revision it references, the completeness check and the proven/deferred completion summary. Call it before reusing an analysis in a new chat: the file, not the conversation, is the state.',
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
    description: 'Create or edit one Analysis Record with compare-and-set and an atomic write. The patch may carry title, requestedSolution, businessOutcome {problem,outcome,successMetrics}, process {current,target}, requirements [{id,kind:BR|FR|NFR,text,acceptance,status:planned|proven|deferred|rejected,reason}], architecture {contractImpact:none|additive|breaking,components[{id,name,responsibility,owner,owns,dependsOn}]}, data, contracts, invariants, decisions, openQuestions, sizing {class:L0|L1|L2,reasons}, designRef, goalId and trace. Trace rows are {requirementId,processId,componentId,contractIds,dataIds,status,tasks[{taskId,role,evidence}],reason}. An existing record needs expectedRev; a stale one is refused. status:"ready" is accepted only when analysis_check has no errors; status:"completed" only when every requirement is proven with task+evidence or explicitly deferred/rejected with a reason. Adding/removing a requirement, changing a requirement to/from deferred/rejected, changing a trace mapping, editing the process/business outcome/architecture/data/contracts/invariants/decisions/open questions/sizing or moving designRef all reopen a ready record and record a pending impact unless resolveImpacts clears it; a requirement with traced tasks cannot be removed (mark it rejected/deferred instead) and a task link cannot be erased from a ready record. goalId is a commitment: it cannot be detached from a ready/completed record.',
    parameters: {
      initiative: { type: 'string', required: true, description: 'Initiative id; also the file name in docs/analysis/.' },
      expectedRev: { type: 'integer', description: 'The revision you read. Required for an existing record; omit or 0 for a new one.' },
      patch: { type: 'object', additionalProperties: true, description: 'Fields to create or replace. Arrays replace; businessOutcome/process/architecture/sizing/designRef merge one level.' },
      resolveImpacts: { type: 'json', description: "Optional: 'all' or an array of pending impact ids to resolve after updating the record." },
      acceptHandEdit: { type: 'boolean', description: 'Acknowledge a semantic fingerprint mismatch caused by editing the file outside analysis_upsert. Without this every write to a hand-edited record is refused.' },
      by: { type: 'string', enum: ['agent', 'human'], description: 'Author recorded on the revision. Default agent.' },
    },
    output: out(),
    execute(args, exec) {
      try {
        return service.upsert(workingDir(exec.agent), {
          initiative: args.initiative,
          expectedRev: args.expectedRev,
          patch: args.patch,
          resolveImpacts: args.resolveImpacts,
          acceptHandEdit: args.acceptHandEdit === true,
          by: args.by,
        })
      } catch (error) {
        return refused(error)
      }
    },
  })

  const checkTool = defineTool({
    name: 'analysis_check',
    description: 'Run the completeness checker over one Analysis Record. It looks past JSON shape: missing business outcome or requested solution, missing process, missing acceptance per requirement, component and data ownership, contract impact, missing/contradictory contract verdicts, unresolved trace (a requirement with no process/component, a trace row pointing at nothing), proven without task or evidence, deferred without a reason, blocking open questions, a moved design map, and a hand-edited fingerprint. With forCompletion:true it also reports which requirements are still planned, so completion separates proven from explicitly deferred.',
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
    description: 'Record that a requirement, component, contract, data item, invariant or the design map changed, and return what the change affects: requirement ids, process ids, component ids, contract/data ids and the task ids already traced to them. It reopens the record as draft and records a pending impact, so the next L1/L2 delegation is refused analysis_stale until the record is updated and resolveImpacts clears it. Call this before continuing after any mid-work change.',
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
    for (const tool of tools) agent.ctx.tools.register(tool)
    if (config.promptSection === false) return
    let order = 123
    try {
      const base = agent.ctx.systemPrompt.getSectionOrder('SUBAGENT_DELEGATION')
      if (Number.isFinite(base)) order = base + 2
    } catch {
      // A prompt registry that cannot report an order still accepts an explicit one.
    }
    try {
      agent.ctx.systemPrompt.section({ name: 'deployment:analysis-policy', order, text: ANALYSIS_POLICY })
    } catch {
      // The tools are the enforcement; a section that cannot register must not break the agent.
    }
  })
}

export { createService }
