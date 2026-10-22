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
 *   are removed with it too.
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
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

/** Resolve the session workspace, falling back to the process directory. */
function workingDir(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd()
}

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'orchestrator'

/** All four services are required; the taskboard row must be mounted first. */
export const inject = ['tools', 'subagents', 'systemPrompt', 'taskboard']

/** Root policy: short enough to read every turn, specific enough to act on. */
const ROOT_POLICY = `## Orchestration policy (deployment)

You are the workspace orchestrator. Before your first action, classify the request.

**One-shot** — a question, one edit, one lookup, a review of one diff, anything that ends in this turn. Do it directly. Do not create a goal, a task, or a child.

**Initiative** — it spans more than one file or subsystem, needs research then implementation then review, will take more than roughly fifteen minutes, or the human asks for a project, feature, migration, audit or setup. Then:

1. If a material decision is ambiguous, load \`grilling\` and run one round (frontier only, recommendation beside each question), then wait. Do not grill a specified task.
2. Create a goal with \`create_goal\`. Create the task graph with \`task_create\`: objective, scope, non-scope, acceptance, dependencies.
3. Delegate every independent task with \`delegate_task\`. One task per child. The brief must be self-contained and name the non-scope. Never delegate final integration or the human's judgment.
4. Use \`workflow\` for deterministic fan-out with structured results; use \`delegate_task\` for focused research or implementation. At most two children at once.
5. Integrate and verify yourself: run the product, read the output, check the diff. A child's report is a claim, not evidence.
6. Render a \`handoff\` at each milestone and at the end. Update the taskboard before you speak to the human. Close the task and the goal.

A one-shot answer never needs this ceremony. A big task never skips it.

## Delegation rules

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
- Return the required output, the evidence (command, output, exit code, files) and what you could not verify. A claim without evidence is not a result.
- Do not write autotests. Prove behavior by running the product.
- Use \`task_note\` for significant findings and \`task_get\` to re-read your task. The orchestrator owns acceptance and the final handoff.`

/**
 * Render a self-contained brief for one child.
 *
 * @param task - The created task record.
 * @param input - Tool arguments.
 * @param limit - Longest allowed brief.
 * @returns The brief text.
 */
export function renderBrief(task, input, limit = 20000) {
  const list = (label, values) => {
    const entries = Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value.trim() !== '') : []
    return entries.length === 0 ? `${label}: (none stated)\n` : `${label}:\n${entries.map((entry) => `- ${entry}`).join('\n')}\n`
  }
  const brief = `You are a delegated specialist in DeepSeek Harness. Task ${task.id}: ${task.title}

${list('Objective', [task.objective])}
${list('Scope (you may touch)', task.scope)}
${list('Non-scope (do not touch)', task.nonScope)}
${list('Inputs', input.inputs)}
${list('Acceptance (the orchestrator decides)', task.acceptance.map((entry) => entry.text))}

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
    description: 'Create one task in the workspace taskboard, render a self-contained brief, start a flash child for it, and link the child session to the task. Use it for independent research, implementation or review work; do not use it for a one-shot answer or for final integration.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short task title; also the child label.' },
      objective: { type: 'string', required: true, description: 'The outcome in one paragraph, not the activity.' },
      scope: { type: 'array', items: { type: 'string' }, description: 'What the child may touch.' },
      nonScope: { type: 'array', items: { type: 'string' }, description: 'What the child must not touch, with the reason.' },
      acceptance: { type: 'array', items: { type: 'string' }, description: 'How you will judge the result.' },
      inputs: { type: 'array', items: { type: 'string' }, description: 'Files, decisions and links the child needs.' },
      timebox: { type: 'string', description: 'Optional timebox or stopping condition.' },
      parentTaskId: { type: 'string', description: 'Optional parent task id.' },
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
      const childCwd = typeof args.cwd === 'string' && args.cwd !== '' ? args.cwd : workingDir(parent)
      const taskCwd = workingDir(parent)
      let taskboard
      try {
        taskboard = ctx.get('taskboard')
      } catch {
        taskboard = undefined
      }
      if (taskboard === undefined) throw new Error('delegate_task: the taskboard is reloading; start a new conversation or retry')
      const task = taskboard.create(taskCwd, {
        title: args.title,
        objective: args.objective,
        scope: args.scope,
        nonScope: args.nonScope,
        acceptance: args.acceptance,
        parentId: args.parentTaskId,
        parentSessionId: parent.id,
        priority: args.priority,
        status: 'ready',
      }, 'orchestrator')

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
      const agentOptions = subagentProvider.capabilities?.agentOptions === true
        ? { provider: childProvider, model: childModel, reasoningEffort: 'high' }
        : undefined
      try {
        exec.signal.throwIfAborted()
        const activation = await ctx.subagents.startActivation({
          provider,
          label: `${task.id} · ${task.title}`.slice(0, 160),
          request: {
            prompt: [{ type: 'text', text: brief }],
            parent,
            ...(childCwd === workingDir(parent) ? {} : { cwd: childCwd }),
            ...(agentOptions === undefined ? {} : { agentOptions }),
          },
          signal: exec.signal,
          delivery: 'parent',
        })
        taskboard.linkChild(taskCwd, { id: task.id, sessionId: activation.childId, label: task.title, role: args.role ?? task.title })
        return { taskId: task.id, childId: activation.childId, title: task.title, status: 'active' }
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
    if (promptSections) {
      const base = ctx.systemPrompt.getSectionOrder('SUBAGENT_DELEGATION')
      agent.ctx.systemPrompt.section({
        name: isRoot ? 'deployment:orchestrator-policy' : 'deployment:specialist-policy',
        order: Number.isFinite(base) ? base + (isRoot ? 1 : 2) : (isRoot ? 121 : 122),
        text: isRoot ? ROOT_POLICY : CHILD_POLICY,
      })
    }
    if (isRoot) agent.ctx.tools.register(definition)
  })
}

export { ROOT_POLICY, CHILD_POLICY }
