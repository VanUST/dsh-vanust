/**
 * PURPOSE
 *   Make the conversation's root agent an orchestrator without replacing the
 *   standard preset. It registers a root-only policy section on `agent/created`,
 *   a child-only specialist section, and a root-only `delegate_task` tool that
 *   creates a task in the taskboard, renders a self-contained brief, starts a
 *   flash child, and links the child id back to the task. The policy applies to
 *   every preset; a preset is a tool list, not a way to remember the policy.
 *
 * INPUTS
 *   Config (all optional):
 *     provider        subagent provider. Default "spawn".
 *     childProvider   LLM route for the child. Default "deepseek-official".
 *     childModel      model for the child. Default "deepseek-flash".
 *     maxBriefChars   longest rendered brief. Default 20000.
 *     promptSections  false turns the two policy sections off. Default true.
 *
 * OUTPUTS
 *   Scoped prompt sections and one scoped tool per root agent; no global tool,
 *   no service, no session event. The task and child link are the taskboard's
 *   durable records. The root tool is removed with the agent, and the sections
 *   are removed with it too. The root policy carries the workspace's existing
 *   roles, read from the ledger at assembly time.
 *
 * KEYWORDS
 *   orchestrator, delegate_task, task brief, scope, non-scope, flash child,
 *   root policy, specialist policy
 *
 * BEHAVIOUR ON EDGE CASES
 *   - The tool is registered only on a root agent (delegationDepth 0 or absent).
 *     A child cannot recurse through it; the existing depth limit still applies.
 *   - A provider that does not support `agentOptions` gets no model override; the
 *     flash guard is the backstop.
 *   - A brief over `maxBriefChars` is truncated with a visible note rather than
 *     failing the delegation after the task was created.
 *   - A failed child start marks the task blocked with the error as a risk and
 *     rethrows, so the orchestrator sees the failure instead of a silent no-op.
 *   - The task is created before the child, so a crash between the two leaves a
 *     task the human can see and retry rather than an invisible child.
 *   - A role name that normalizes to an existing one, or contains it (`BACKEND-SAM`
 *     beside `BACKEND`), is refused BEFORE a task is created, with the existing names
 *     listed. forceRole: true is the escape hatch for a genuinely new domain.
 *   - A specialist session belongs to the chat that created it: the subagent runtime
 *     only delivers to a direct child, so a later chat's message cannot reach it. The
 *     role is then re-created, the ledger keeps the superseded session ids in
 *     history[] with a generation counter, and the result says roleRecreated with the
 *     runtime's reason instead of reporting a reuse that did not happen.
 *   - A re-created specialist's brief carries the role's most recent results from the
 *     taskboard, and says the code must be re-read: a summary is a claim about the
 *     past, not a reading of the present.
 *   - delegate_task(taskId) attaches to that task (it must be open, not paused, and
 *     already this role or none) instead of creating a second row for the same work.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

/** Resolve the session workspace, falling back to the process directory. */
function workingDir(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd()
}

/** Collapse a role name to letters and digits, so BACKEND, Backend and back-end meet. */
export function normalizeRole(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * Whether two role names denote the same specialty.
 *
 * Deliberately narrow: equality after normalization, or a containment where the shorter
 * name is at least four characters. `BACKEND` therefore catches `BACKEND-SAM`, while
 * `UI` stays distinct from `UX/UI`. Anything fuzzier would refuse legitimate new roles,
 * and a refused delegation is worse than a duplicated one.
 */
export function roleMatches(left, right) {
  const a = normalizeRole(left)
  const b = normalizeRole(right)
  if (a === '' || b === '') return false
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 4 && long.includes(short)
}

/**
 * Render the roles this workspace already has, for the root agent's prompt.
 *
 * WHY IN THE PROMPT AND NOT ONLY IN AN ERROR. A new chat starts without the ledger in
 * context, so the model invents AUDIT where BACKEND already exists; refusing later is a
 * correction, listing first is a choice. The section is a provider, so the list is read
 * at assembly time and a role created a minute ago appears on the next turn.
 */
export function renderRoleCatalog(agents, limit = 24) {
  const rows = Array.isArray(agents) ? agents.filter((agent) => agent !== null && typeof agent === 'object' && typeof agent.role === 'string') : []
  if (rows.length === 0) return '## Roles already in this workspace\n\nNone yet. The first delegation creates one.'
  const lines = rows.slice(0, limit).map((agent) => {
    const count = Number.isSafeInteger(agent.taskCount) ? agent.taskCount : 0
    const generation = Number.isSafeInteger(agent.generation) && agent.generation > 1 ? `, generation ${agent.generation}` : ''
    const status = typeof agent.status === 'string' ? agent.status : 'unknown'
    return `- ${agent.role} - ${count} task${count === 1 ? '' : 's'}, ${status}${generation}`
  })
  return [
    '## Roles already in this workspace',
    '',
    'Reuse one of these exact names. A new role is for a NEW domain, not for the same work in a new chat.',
    '',
    ...lines,
  ].join('\n')
}

/**
 * Render what a re-created specialist inherits from the role's earlier work.
 *
 * A specialist session dies with the chat that created it, so the next chat's child is a
 * stranger. The taskboard is the only thing that survives, so the brief carries the
 * outcome of the role's last tasks - and says plainly that the code must be re-read,
 * because a summary is a claim about the past, not a reading of the present.
 */
export function renderCarryForward(tasks, role, limit = 1400) {
  const rows = Array.isArray(tasks) ? tasks.filter((task) => task !== null && typeof task === 'object' && roleMatches(task.role ?? '', role)) : []
  if (rows.length === 0) return ''
  const recent = [...rows]
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
    .slice(0, 3)
  const lines = recent.map((task) => {
    const summary = typeof task.result?.summary === 'string' ? task.result.summary.trim().replace(/\s+/g, ' ') : ''
    const head = `- ${task.id} \"${(task.title ?? '').slice(0, 90)}\" (${task.status ?? 'unknown'}, ${String(task.updatedAt ?? '').slice(0, 10)})`
    return summary === '' ? head : `${head}: ${summary.slice(0, 260)}`
  })
  const text = [
    '## What this role already knows (from earlier chats)',
    '',
    'Its previous session is gone. This is what the role finished, so do not redo it and do not assume it still holds - re-read the code first.',
    '',
    ...lines,
  ].join('\n')
  return text.length <= limit ? text : `${text.slice(0, limit - 80)}\n\n[Carried context truncated; the taskboard holds the rest.]`
}

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'orchestrator'

/** All four services are required; the taskboard row must be mounted first. */
export const inject = ['tools', 'subagents', 'systemPrompt', 'taskboard']

/** Root policy: short enough to read every turn, specific enough to act on. */
const ROOT_POLICY = `## Orchestration policy (deployment)

You are the workspace orchestrator. **Work flows through the taskboard.**

**Answering is not work.** A question, one lookup, an explanation, a review of a diff you were handed: answer it directly. No goal, no task, no child.

**Any change is a task, delegated or not.** Before the first write of a change — an edit, a bug fix, a config change, a migration step, an audit, a feature — open it with \`task_create\` (objective, scope, non-scope, acceptance), move it to \`active\` when you start, and finish with \`task_update\` to \`review\` (then \`task_close\` when the human accepts). Put what a stranger would need to resume into \`task_note\`.

That ledger is not bookkeeping for delegation: it is the record that outlives this session. The Tasks panel is where the human watches work in flight, a task survives a restart that a session does not, and a second session in the same workspace sees it there. "What is left to do" is answered from the taskboard, not by re-reading a conversation.

**Delegation is one way to run a task, never the trigger for one.** \`delegate_task\` creates the task and starts a child for it; a task you execute yourself has the same lifecycle and the same record. Create the task first, then choose: do it inline, or delegate it.

**Bigger than one sitting** — more than one file or subsystem, research then implementation then review, more than roughly fifteen minutes, or the human asks for a project, feature, migration, audit or setup:

1. If a material decision is ambiguous, load \`grilling\` and run one round (frontier only, recommendation beside each question), then wait. Do not grill a specified task.
2. Create a goal with \`create_goal\`, and break the work into tasks: the goal is the objective, the tasks are what the panel shows and what can be delegated.
3. Delegate the independent tasks with \`delegate_task\`. One task per child. The brief must be self-contained and name the non-scope. Never delegate final integration or the human's judgment.
4. Use \`workflow\` for deterministic fan-out with structured results; at most two children at once.
5. Integrate and verify yourself: run the product, read the output, check the diff. A child's report is a claim, not evidence.
6. Render a \`handoff\` at each milestone and at the end. Update the taskboard before you speak to the human. Close the tasks and the goal.

A question never needs this ceremony. A change never skips the task.

## Delegation rules

- Reuse a role from the catalog appended below this policy. \`delegate_task\` refuses a near-duplicate new role unless the work really is a new domain; \`forceRole: true\` overrides that refusal.
- Pass \`taskId\` when one of your own tasks is the work: the brief then attaches to that task instead of creating a second row for the same thing.
- A specialist session belongs to the chat that created it. A later chat gets a new one, and the brief then carries the role's earlier results forward - say so in the brief you write, and never assume the child remembers.
- Children run on flash. Do not request another model for a child; naming one is refused or rewritten.
- Every brief states: objective, scope, non-scope, inputs, acceptance, required output, proof and timebox.
- The child owns its task's work, not its acceptance. The task moves to review when the child settles; you decide done.
- No autotests. Prove behavior by running the product and quoting the command, output and exit code. A test file only when the human asks and the behavior is non-trivial.
- A handoff is one page: TL;DR, objective, changes, evidence, decisions, risks, next actions. Prefer a diagram when relationships are the point.`

/** Child policy: the specialist reads its brief and nothing else competes. */
const CHILD_POLICY = `## Delegated specialist policy (deployment)

You are a delegated specialist. Do exactly the task brief you received.

- Read the code and the callers before you edit. Take the smallest complete change; reuse what exists; do not add a dependency for a few lines.
- Do not expand scope. If the brief is wrong or incomplete, say so and stop rather than guess.
- You may be a persistent role specialist: you can receive several task briefs in this session. Keep your assigned role, treat each new message as one task, and do not spawn children.
- Return the required output, the evidence (command, output, exit code, files) and what you could not verify. A claim without evidence is not a result.
- Do not write autotests. Prove behavior by running the product.
- Use \`task_note\` for significant findings and \`task_get\` to re-read your task. The orchestrator owns acceptance and the final handoff.`

/**
 * Render a self-contained brief for one child.
 *
 * @param task - The created task record.
 * @param input - Tool arguments.
 * @param limit - Longest allowed brief.
 * @param extra - Optional blocks. `carryForward` is what the role already finished.
 * @returns The brief text.
 */
export function renderBrief(task, input, limit = 20000, extra = {}) {
  const list = (label, values) => {
    const entries = Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value.trim() !== '') : []
    return entries.length === 0 ? `${label}: (none stated)\n` : `${label}:\n${entries.map((entry) => `- ${entry}`).join('\n')}\n`
  }
  const brief = `You are a delegated specialist in DeepSeek Harness. Task ${task.id}: ${task.title}

Role: ${input.role ?? task.role ?? 'specialist'}
${list('Objective', [task.objective])}
${list('Scope (you may touch)', task.scope)}
${list('Non-scope (do not touch)', task.nonScope)}
${list('Inputs', input.inputs)}
${list('Acceptance (the orchestrator decides)', task.acceptance.map((entry) => entry.text))}
${typeof extra.carryForward === 'string' && extra.carryForward.trim() !== '' ? `\n${extra.carryForward}\n` : ''}
## Required output

1. Summary — at most ten lines, the outcome first.
2. Evidence — the commands you ran, their output and exit codes, and the files you changed. A claim without evidence is not a result.
3. What you skipped or could not verify.
4. Risks or decisions the orchestrator must know.

## Rules

- Read the callers before you edit; take the smallest complete change; do not add a dependency for a few lines.
- Do not write autotests. Run the product and quote what it produced. A test file only if this brief explicitly asks for one, and then name the production behavior it protects.
- Do not expand scope. If the brief is wrong, say so and stop.
- Use \`task_note\` for significant findings and \`task_get\` to re-read the task. The orchestrator owns acceptance.

${input.timebox === undefined ? '' : `Timebox: ${input.timebox}\n`}`
  if (brief.length <= limit) return brief
  return `${brief.slice(0, limit - 160)}\n\n[Brief truncated at ${limit} characters. The task fields remain authoritative; ask the orchestrator for the missing part.]`
}

/**
 * Register the policy and the delegation tool.
 *
 * @param ctx - Cordis context.
 * @param config - Raw plugin config.
 */
export function apply(ctx, config = {}) {
  const provider = typeof config.provider === 'string' && config.provider !== '' ? config.provider : 'spawn'
  const childProvider = typeof config.childProvider === 'string' && config.childProvider !== '' ? config.childProvider : 'deepseek-official'
  const childModel = typeof config.childModel === 'string' && config.childModel !== '' ? config.childModel : 'deepseek-flash'
  const maxBriefChars = Number.isSafeInteger(config.maxBriefChars) && config.maxBriefChars > 0 ? config.maxBriefChars : 20000
  const promptSections = config.promptSections !== false

  const definition = defineTool({
    name: 'delegate_task',
    description: 'Create one task in the workspace taskboard (or attach an existing one with taskId), render a self-contained brief, start a flash child for it, and link the child session to the task. Reuse a role from the catalog in your policy: a near-duplicate new role is refused unless forceRole is passed. One piece of work is one task - pass taskId when the task already exists. Use it for independent research, implementation or review work; not for a one-shot answer or for final integration.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short task title.' },
      role: { type: 'string', required: true, description: 'Persistent specialist role, e.g. UX/UI, BACKEND, BUSINESS, RESEARCH. The roles this workspace already has are listed in your policy section - reuse one of those exact names; all fitting tasks belong to it.' },
      roleDescription: { type: 'string', description: 'Optional one-line responsibility zone for a newly created specialist.' },
      objective: { type: 'string', required: true, description: 'The outcome in one paragraph, not the activity.' },
      scope: { type: 'array', items: { type: 'string' }, description: 'What the child may touch.' },
      nonScope: { type: 'array', items: { type: 'string' }, description: 'What the child must not touch, with the reason.' },
      acceptance: { type: 'array', items: { type: 'string' }, description: 'How you will judge the result.' },
      inputs: { type: 'array', items: { type: 'string' }, description: 'Files, decisions and links the child needs.' },
      timebox: { type: 'string', description: 'Optional timebox or stopping condition.' },
      parentTaskId: { type: 'string', description: 'Optional parent task id.' },
      taskId: { type: 'string', description: 'Attach this delegation to an existing task instead of creating a second one. The task must not be done, cancelled or paused, and its role must match.' },
      forceRole: { type: 'boolean', description: 'Allow a role name that resembles an existing one. Use only for a genuinely different specialty; naming the work with the existing role is almost always right.' },
      cwd: { type: 'string', description: 'Optional working directory; inherits the parent cwd.' },
      priority: { type: 'string', enum: ['low', 'normal', 'high'], description: 'Task priority.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (parent === undefined) throw new Error('delegate_task requires a calling agent')
      const role = typeof args.role === 'string' ? args.role.trim() : ''
      if (role === '') throw new Error('delegate_task: role is required (for example BACKEND, UX/UI, BUSINESS; reuse one role across tasks)')
      const childCwd = typeof args.cwd === 'string' && args.cwd !== '' ? args.cwd : workingDir(parent)
      const taskCwd = workingDir(parent)
      let taskboard
      try {
        taskboard = ctx.get('taskboard')
      } catch {
        taskboard = undefined
      }
      if (taskboard === undefined) throw new Error('delegate_task: the taskboard is reloading; start a new conversation or retry')
      // A fresh chat does not know the ledger, so the model invents AUDIT where BACKEND
      // already exists. Refusing before a task exists is a correction; the catalog in the
      // policy section is the choice it should have seen. forceRole is the escape hatch.
      const knownAgent = (() => {
        try {
          return taskboard.findAgent(taskCwd, role)
        } catch {
          return undefined
        }
      })()
      if (knownAgent === undefined && args.forceRole !== true) {
        let agents = []
        try {
          agents = taskboard.agents(taskCwd)
        } catch {
          agents = []
        }
        const similar = agents.filter((agent) => roleMatches(agent.role, role))
        if (similar.length > 0) {
          const names = similar.map((agent) => `"${agent.role}"`).join(', ')
          throw new Error(`delegate_task: "${role}" is ${names} written differently. Reuse that exact role name; pass forceRole: true only if this is a genuinely different specialty.`)
        }
      }

      // One piece of work is one row. The root usually creates the task first and then
      // delegates it; attaching keeps that pair from becoming two near-duplicate tasks.
      const attachId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
      let task
      if (attachId !== '') {
        const existing = taskboard.get(taskCwd, attachId)
        if (existing === undefined) throw new Error(`delegate_task: no task "${attachId}" in this workspace`)
        if (existing.status === 'done' || existing.status === 'cancelled') {
          throw new Error(`delegate_task: task "${attachId}" is ${existing.status}; open a new task instead`)
        }
        if (existing.status === 'paused') throw new Error(`delegate_task: task "${attachId}" is paused; resume it before delegating`)
        if (typeof existing.role === 'string' && existing.role !== '' && !roleMatches(existing.role, role)) {
          throw new Error(`delegate_task: task "${attachId}" already belongs to role "${existing.role}"; delegate it to that role or open a new task`)
        }
        const updated = taskboard.update(taskCwd, {
          id: existing.id,
          expectedRevision: existing.revision,
          patch: { status: 'active', role, priority: args.priority },
        })
        task = updated?.ok === true ? updated.task : existing
      } else {
        task = taskboard.create(taskCwd, {
          title: args.title,
          role,
          objective: args.objective,
          scope: args.scope,
          nonScope: args.nonScope,
          acceptance: args.acceptance,
          parentId: args.parentTaskId,
          parentSessionId: parent.id,
          priority: args.priority,
          status: 'ready',
        }, 'orchestrator')
      }

      const subagentProvider = ctx.subagents.getProvider(provider)
      if (subagentProvider === undefined) {
        taskboard.update(taskCwd, {
          id: task.id,
          expectedRevision: task.revision,
          patch: { status: 'blocked', result: { risks: [`subagent provider "${provider}" is not registered`] } },
        })
        throw new Error(`delegate_task: subagent provider "${provider}" is not registered`)
      }

      const brief = renderBrief(task, args, maxBriefChars)
      const roleBrief = `You are the persistent ${role} specialist for this workspace. Responsibility: ${typeof args.roleDescription === 'string' && args.roleDescription.trim() !== '' ? args.roleDescription.trim() : role}. Stay in this role across every task you receive; do not spawn subagents. Each new message is a separate task brief. Use task_note/task_get for the task you are handling; the orchestrator owns acceptance.`
      const agentOptions = subagentProvider.capabilities?.agentOptions === true
        ? { provider: childProvider, model: childModel, reasoningEffort: 'high' }
        : undefined
      let childId = knownAgent?.sessionId
      let reused = false
      let reuseNote
      let childBrief = brief
      try {
        exec.signal.throwIfAborted()
        if (typeof childId === 'string' && childId !== '') {
          try {
            await ctx.subagents.sendMessage(parent, childId, [{ type: 'text', text: brief }], { signal: exec.signal })
            reused = true
            taskboard.touchAgent(taskCwd, { sessionId: childId, status: 'active', taskId: task.id })
          } catch (error) {
            // A specialist session belongs to the chat that created it: the subagent runtime
            // only delivers to a direct child, so a role's earlier session is unreachable from
            // here. Report it instead of calling the role asleep, and carry its results in.
            reuseNote = error instanceof Error ? error.message : String(error)
            childId = undefined
          }
        }
        if (!reused) {
          let carryForward = ''
          if (knownAgent !== undefined) {
            try {
              carryForward = renderCarryForward(taskboard.list(taskCwd), role)
            } catch {
              carryForward = ''
            }
          }
          childBrief = carryForward === '' ? brief : renderBrief(task, args, maxBriefChars, { carryForward })
          const activation = await ctx.subagents.startActivation({
            provider,
            label: role.slice(0, 160),
            request: {
              prompt: [{ type: 'text', text: `${roleBrief}\n\n${childBrief}` }],
              parent,
              ...(childCwd === taskCwd ? {} : { cwd: childCwd }),
              ...(agentOptions === undefined ? {} : { agentOptions }),
            },
            signal: exec.signal,
            delivery: 'parent',
          })
          childId = activation.childId
          taskboard.registerAgent(taskCwd, { role, label: role, sessionId: childId, taskId: task.id, chatSessionId: parent.id })
          if (reuseNote !== undefined) {
            try {
              ctx.logger?.warn?.(`delegate_task: role "${role}" re-created in this chat (${reuseNote})`)
            } catch {
              // A logger that cannot log must not fail the delegation.
            }
          }
        }
        taskboard.linkChild(taskCwd, { id: task.id, sessionId: childId, label: role, role })
        return {
          taskId: task.id,
          childId,
          role,
          reused,
          title: task.title,
          status: 'active',
          ...(reuseNote === undefined ? {} : { roleRecreated: true, roleNote: reuseNote, carriedResults: knownAgent !== undefined }),
        }
      } catch (error) {
        try {
          taskboard.update(taskCwd, {
            id: task.id,
            expectedRevision: task.revision,
            patch: { status: 'blocked', result: { risks: [`child start failed: ${error.message}`] } },
          })
        } catch {
          // The task update is best-effort; the original failure is the one to report.
        }
        throw error
      }
    },
  })

  ctx.on('agent/created', ({ agent }) => {
    const depth = Number(agent?.session?.header?.delegationDepth ?? 0)
    const isRoot = !(Number.isFinite(depth) && depth > 0)
    // The catalog is read at assembly time, not at boot: a role created a minute ago in
    // this same chat appears on the next turn, and a new chat starts already knowing the
    // workspace's roles instead of inventing them again.
    const rootText = () => {
      try {
        return `${ROOT_POLICY}\n\n${renderRoleCatalog(ctx.taskboard.agents(workingDir(agent)))}`
      } catch {
        return ROOT_POLICY
      }
    }
    if (promptSections) {
      const base = ctx.systemPrompt.getSectionOrder('SUBAGENT_DELEGATION')
      agent.ctx.systemPrompt.section({
        name: isRoot ? 'deployment:orchestrator-policy' : 'deployment:specialist-policy',
        order: Number.isFinite(base) ? base + (isRoot ? 1 : 2) : (isRoot ? 121 : 122),
        text: isRoot ? rootText : CHILD_POLICY,
      })
    }
    if (isRoot) agent.ctx.tools.register(definition)
  })
}

export { ROOT_POLICY, CHILD_POLICY }
