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
 *   no service, and no session event of its own (it observes turn/start only to
 *   refresh the policy block once per turn). The task and child link are the taskboard's
 *   durable records. The root tool is removed with the agent, and the sections
 *   are removed with it too. The root policy carries the workspace's existing
 *   roles, read from the ledger once per turn.
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
 *   - A taskboard REFUSAL stops the delegation before a child exists: a refused create
 *     (`board_full`) has no row to work on, a refused attach (`stale`, `other_chat`) is not a
 *     task this chat may claim, and the pre-flight note is the first write that proves the
 *     row is ours. Each returns `{ok:false, code, message}` and blocks the row with the code
 *     when the same guard allows it. A refused linkChild after the start interrupts that
 *     child, so a live child never works for a task that does not record it.
 *   - Root detection is the taskboard's lineage rule: depth > 0, a `parentSession` header or
 *     `origin: 'subagent'` all mean CHILD, so a depth-0 subagent never gets the root policy
 *     or `delegate_task`.
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
 *   - The root policy appends a short board-debt block: tasks parked in review with the
 *     age of the oldest, and `ready` tasks that have a role but no child - a delegation
 *     that never started. `active` with no child is NOT debt: that is inline work.
 *   - The role catalog and the board debt are frozen from the first step of a turn to
 *     the last: a board write mid-turn does not rewrite the system prompt, because on a
 *     caching provider that re-bills the whole conversation from the first changed byte.
 *     The next turn re-reads the ledger, so a role created a minute ago still appears.
 *   - A delegation writes a "Delegating to <role>" note before the child starts, and the
 *     failure path re-reads the task's revision, sets it blocked, and appends a note even
 *     when that update refuses. A task can no longer sit in `ready` saying only "Created".
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

/**
 * The tool compositions this deployment runs, in roster order. A role names the
 * task; a preset names the tools the child actually gets. They are separate on
 * purpose: the taskboard wants a human-readable specialty ("AUDIT"), while the
 * child's tool list must be one of a known seven, because isolation that comes from
 * a preset's registrations cannot be talked around by a brief.
 *
 * `critic` is the seventh: an adversarial tester that attacks a RUNNING behaviour on a
 * disposable copy and reports the smallest failing case. It is not the reviewer (which
 * judges a diff) and not UX/UI (which tests an interface), so it gets its own tools and
 * its own preset instead of being a wording variant of either.
 *
 * `audit` used to map to `reviewer`, which made one name mean two jobs: the autolabel board
 * carried `AUDIT [reviewer]` and `AUDIT [critic]`, and the second registration overwrote the
 * first's preset. The name is deliberately NOT in this table any more - a delegation asking
 * for AUDIT is told to choose REVIEWER or CRITIC, and a board that still holds the label keeps
 * it as history (scripts/taskboard-migrate.mjs splits the rows it can still prove).
 */
export const PRESET_IDS = ['ux', 'backend', 'research', 'reviewer', 'critic', 'docs']

/** Role spellings that denote one of the seven compositions. Keys are normalizedRole() output. */
export const ROLE_PRESETS = {
  ux: 'ux',
  ui: 'ux',
  uxui: 'ux',
  design: 'ux',
  designer: 'ux',
  backend: 'backend',
  backenddev: 'backend',
  server: 'backend',
  api: 'backend',
  research: 'research',
  researcher: 'research',
  researchfirst: 'research',
  reviewer: 'reviewer',
  review: 'reviewer',
  critic: 'critic',
  criticgeneral: 'critic',
  generalcritic: 'critic',
  qa: 'critic',
  tester: 'critic',
  test: 'critic',
  docs: 'docs',
  doc: 'docs',
  documentation: 'docs',
  documenter: 'docs',
  docssteward: 'docs',
}

/** The preset a role name denotes, or undefined when it denotes none of the seven. */
export function presetForRole(role) {
  return ROLE_PRESETS[normalizeRole(role)]
}

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
  // A ROLE IS A (NAME, PRESET) PAIR. The old catalog printed one line per row, so a name with
  // two presets looked like two roles (AUDIT [reviewer] and AUDIT [critic]) and a name written
  // twice looked like two specialists. One line per pair, and a name whose pairs disagree is
  // called out as ambiguous instead of being offered for reuse.
  const seen = new Set()
  const reusable = []
  const legacy = []
  const presets = new Map()
  for (const agent of rows) {
    const preset = typeof agent.preset === 'string' ? agent.preset.trim() : ''
    const key = `${normalizeRole(agent.role)}|${preset}`
    if (seen.has(key)) continue
    seen.add(key)
    const label = normalizeRole(agent.role)
    presets.set(label, new Set([...(presets.get(label) ?? []), preset]))
    const line = agentLine(agent, preset)
    if (preset === '') legacy.push(line)
    else reusable.push(line)
  }
  const ambiguous = [...presets].filter(([, set]) => set.size > 1).map(([label]) => {
    const names = rows.filter((agent) => normalizeRole(agent.role) === label)
    return names[0].role
  })
  const sections = [['## Roles already in this workspace', '', 'Reuse one of these exact names. A new role is for a NEW domain, not for the same work in a new chat.', '', ...reusable.slice(0, limit)]]
  if (ambiguous.length > 0) {
    sections[0].push(
      '',
      `A name with two presets is ambiguous - ${ambiguous.map((name) => `"${name}"`).join(', ')}. Split it: REVIEWER judges a change, CRITIC attacks a running behaviour; pass \`preset\` only for a genuinely new specialty.`,
    )
  }
  if (legacy.length > 0) {
    // HISTORY, NOT A TARGET. A row without a preset predates the roster: its child ran on a
    // composition the ledger cannot name, so reusing the session would run a new brief on an
    // unknown tool set. The tasks stay under the old name; the NAME is not offered again.
    sections.push(['## Legacy roles (history only - do not reuse)', '', 'These roles predate role presets, so their child\'s tool set is unknown. Keep their tasks as history and name new work with one of the roles above; delegate_task refuses these names without forceRole.', '', ...legacy.slice(0, limit)])
  }
  return sections.map((lines) => lines.join('\n')).join('\n\n')
}

/** One catalog line: the name, its preset, what it did and whether it can be reused. */
function agentLine(agent, preset) {
  const count = Number.isSafeInteger(agent.taskCount) ? agent.taskCount : 0
  const generation = Number.isSafeInteger(agent.generation) && agent.generation > 1 ? `, generation ${agent.generation}` : ''
  const status = typeof agent.status === 'string' ? agent.status : 'unknown'
  const flag = agent.conflict === true ? ', NAME COLLIDES - one of two rows' : agent.legacy === true ? ', no preset - not reusable' : ''
  return `- ${agent.role}${preset === '' ? '' : ` [${preset}]`} - ${count} task${count === 1 ? '' : 's'}, ${status}${generation}${flag}`
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

/** Whole days since an ISO timestamp, for the debt line. */
function ageDays(value) {
  const at = Date.parse(String(value ?? ''))
  if (Number.isNaN(at)) return 'unknown'
  const days = Math.floor((Date.now() - at) / 86400000)
  return days < 1 ? 'today' : `${days}d`
}

/**
 * Render the debt a fresh chat should see before it adds work.
 *
 * WHY. Measured in ~/tasks/3d (2026-10-30): seven of twelve tasks sat in review for
 * four days because the chats that produced them ended and nobody accepted, and one
 * task was `ready` with a role and no child - a delegation that never started, with no
 * trace beyond its own creation. Nothing surfaced either to the next chat. `active` with
 * no child is NOT debt: that is a task the root is doing itself, by policy.
 */
export function renderBoardDebt(tasks, limit = 600) {
  const rows = Array.isArray(tasks) ? tasks.filter((task) => task !== null && typeof task === 'object') : []
  const review = rows.filter((task) => task.status === 'review')
  // `proposed` and `ready` were merged into `open`; the ledger maps them on read, so a row
  // written before the merge is still caught here.
  const notStarted = (task) => task.status === 'open' || task.status === 'proposed' || task.status === 'ready'
  const stalled = rows.filter((task) => notStarted(task) && typeof task.role === 'string' && task.role !== '' && (task.childSessionIds ?? []).length === 0)
  if (review.length === 0 && stalled.length === 0) return ''
  const lines = ['## Board debt', '']
  if (review.length > 0) {
    const oldest = review.map((task) => task.updatedAt ?? task.createdAt ?? '').sort()[0]
    lines.push(`- ${review.length} task${review.length === 1 ? '' : 's'} in review, oldest ${ageDays(oldest)}. Accept, reopen or cancel them before adding more: they are waiting on this workspace, not on the chat that created them.`)
  }
  if (stalled.length > 0) {
    const shown = stalled.slice(0, 4).map((task) => `${task.id} \"${String(task.title ?? '').slice(0, 50)}\"`).join(', ')
    lines.push(`- ${stalled.length} task${stalled.length === 1 ? '' : 's'} ready with a role and no child: the delegation never started. Attach it with delegate_task(taskId: ...) instead of opening a second task: ${shown}`)
  }
  const text = lines.join('\n')
  return text.length <= limit ? text : `${text.slice(0, limit - 70)}\n[More debt on the board; task_list lists it.]`
}
/**
 * Freeze a rendered prompt block until the next turn starts.
 *
 * WHY. The role catalog and the board debt are read from the live ledger, so every
 * task_create, task_update, task_close and delegate_task inside a turn changes their
 * text. The harness turns a changed section into a new system message, and a provider
 * that caches the prompt prefix re-bills everything from the first changed byte. Measured
 * on `kimi-coding` (2026-11-09, session df8c3329, 59 steps, 200-310K-token context):
 * 19 of the 20 steps that carried a changed system prompt came back with cacheRead=1792,
 * while untouched steps read 96K-313K from cache - 4.6M of that session's 5.0M fresh
 * input, and a 5-hour quota gone in eight minutes. One render per turn keeps the prefix
 * byte-identical for every step of the turn; the ledger is still re-read before the
 * next turn's first step, so a role or a review count changed a minute ago is visible
 * then.
 *
 * @param render - Reads the ledger and returns the block text.
 * @returns `text()` for the prompt section and `freeze()` to call at a turn boundary.
 */
export function freezePerTurn(render) {
  let text = null
  return {
    /** The block for this turn, rendered on first use after the last freeze. */
    text() {
      if (text === null) text = render()
      return text
    },
    /** Drop the memo so the next `text()` re-reads the ledger. */
    freeze() {
      text = null
    },
  }
}

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'orchestrator'

/** All four services are required; the taskboard row must be mounted first. */
export const inject = ['tools', 'subagents', 'systemPrompt', 'taskboard']

/** Root policy: short enough to read every turn, specific enough to act on. */
const ROOT_POLICY = `## Orchestration policy (deployment)

You are the workspace orchestrator. **Work flows through the taskboard.**

**Answering is not work.** A question, one lookup, an explanation, a review of a diff you were handed: answer it directly. No goal, no task, no child.

**Report once, when the work is done.** A human who walked away reads the last message, not the seven before it, so an intermediate summary is tokens and attention spent twice. While a turn is still running, the taskboard note and the tool output are the record; write the report when the work is finished. A goal that continues on its own does not get a report per round either - one, at the end.

**No ad hoc policy.** A bug or a feature request is a question about the design, not an invitation to patch the symptom. Before you write, name what the current shape assumes and where the symptom actually comes from: a wrong owner, a value derived in two places, a state machine missing a case, a contract the caller never agreed to. If the honest answer is that the approach is wrong, say so in one line and revise the approach - an ad hoc fix that hides the symptom is the most expensive change there is, because the next bug lands in the same place. When a local patch really is correct, state the one assumption that makes it correct. Fix the cause once, where it lives.

**Any change is a task, delegated or not.** Before the first write of a change — an edit, a bug fix, a config change, a migration step, an audit, a feature — open it with \`task_create\` (objective, scope, non-scope, acceptance; pass \`inline: true\` when you do the work yourself), move it to \`active\` when you start, and finish with \`task_update\` to \`review\` — the ledger refuses a review without a result summary and at least one evidence item — then \`task_close\` when the human accepts. The lifecycle is \`open/active/review/done\`; \`blocked\` needs the reason it waits on, and \`cancelled\` is terminal. Put what a stranger would need to resume into \`task_note\`.

That ledger is not bookkeeping for delegation: it is the record that outlives this session. The Tasks panel is where the human watches work in flight, and a task survives a restart that a session does not. **Each chat has its own board**: a new chat starts empty and the panel shows only this chat's tasks. The whole workspace history is still one call away with \`task_list\` scope \`workspace\` — use it when the human asks what was done before, or before reusing a role name. "What is left to do" is answered from the taskboard, not by re-reading a conversation.

**Delegation is one way to run a task, never the trigger for one.** \`delegate_task\` creates the task and starts a child for it; a task you execute yourself has the same lifecycle and the same record. Create the task first, then choose: do it inline, or delegate it.

**Bigger than one sitting** — more than one file or subsystem, research then implementation then review, more than roughly fifteen minutes, or the human asks for a project, feature, migration, audit or setup:

1. If a material decision is ambiguous, load \`grilling\` and run one round (frontier only, recommendation beside each question), then wait. Do not grill a specified task.
2. Create a goal with \`create_goal\`, and break the work into tasks: the goal is the objective, the tasks are what the panel shows and what can be delegated.
3. Delegate the independent tasks with \`delegate_task\`. One task per child. The brief must be self-contained and name the non-scope. Never delegate final integration or the human's judgment.
4. Use \`workflow\` for deterministic fan-out with structured results. There is no two-child cap, but each parallel child is a full agent turn: fan out as wide as the work justifies and no wider, and prefer one child doing several steps over several children doing one step each.
5. Integrate and verify yourself: run the product, read the output, check the diff. A child's report is a claim, not evidence.
6. Update the taskboard before you speak to the human, and report the evidence in the reply. Close the tasks and the goal.
7. Close the loop on what the work taught. If the task produced a non-obvious procedure - a build incantation, a trap, an order of operations that cost a retry - call \`skill_inventory\` and, when nothing covers it, \`skill_evolve\` with the exact steps. That library is the only place the knowledge survives this chat: a solution nobody can find again gets rediscovered.

**A fixed, multi-step procedure goes through babysitter.** When the work is a sequence whose every step must be recorded and re-runnable - a release gate, a migration, a batch audit, a checklist that must not silently skip a step - write it as a process file under \`.babysitter/processes/\` and run it with \`babysitter_run\`, instead of a string of ad-hoc shell steps. One run maps to one taskboard task and leaves a journal the next person can resume. This is for procedures: a single command, a one-off edit or a task whose steps you cannot name in advance does not need a run.

A question never needs this ceremony. A change never skips the task.

## Delegation rules

- Reuse a role from the catalog appended below this policy. \`delegate_task\` refuses a near-duplicate new role unless the work really is a new domain; \`forceRole: true\` overrides that refusal.
- **The seven roles are the tool sets**: UX/UI, BACKEND, RESEARCH, REVIEWER, CRITIC, DOCS. The orchestrator is the eighth and is you. The role picks the child's preset, so the child literally has that role's tools - a BACKEND child cannot run \`papers_*\`, and you cannot run \`bash\` or edit a file at all. Choose the role by the work, not by seniority; a role outside the seven needs an explicit \`preset\` argument. Use REVIEWER to judge a change and CRITIC to attack a running behaviour: the critic breaks the algorithm or service on a disposable copy and reports the smallest reproducible failure, it never fixes and never touches production data - reach for it when "it works" is a claim rather than a measurement.
- Pass \`taskId\` when one of your own tasks is the work: the brief then attaches to that task instead of creating a second row for the same thing.
- A specialist session belongs to the chat that created it. A later chat gets a new one, and the brief then carries the role's earlier results forward - say so in the brief you write, and never assume the child remembers.
- Children run on the configured child route (flash by default), and that is the right default: volume work belongs on the cheap route. You may name a \`provider\`/\`model\` on \`delegate_task\` ONLY when the environment demands it - the default route is throttled, unavailable, or the task needs a capability only the other route has - and only a route listed in Subagent model selection is accepted. Never name a highspeed variant: highspeed routes are refused outright by the model guard.
- Every brief states: objective, scope, non-scope, inputs, acceptance, required output, proof and timebox.
- The child owns its task's work, not its acceptance. The task moves to review when the child settles; you decide done.
- **No speculative tests: observe first, then persist the case.** Explore with the role's own tools, reproduce the behaviour, and only then record it in the case library with \`case_record\` (docs/cases/): an automated case needs its real test file + exact run command and an observed red run before the green one; a case that cannot be automated is recorded with steps, expected outcome and a named reason. Prove behaviour by running the product and quoting the command, output and exit code. A test file only for an observed case, never to guess at behaviour. A requirement the human states in chat is an intake case: record it with \`case_record\` (\`source: human\`), status unverified, and link the task that implements it - never claim a verification you did not run.
- Report one page: TL;DR, objective, changes, evidence, decisions, risks, next actions. Prefer a diagram when relationships are the point.`

/** Child policy: the specialist reads its brief and nothing else competes. */
const CHILD_POLICY = `## Delegated specialist policy (deployment)

You are a delegated specialist. Do exactly the task brief you received.

- Your tools are the role's tool set, chosen by the orchestrator when it started you. Do not try to work around a missing tool: if the work needs something outside your composition, stop and report that instead of improvising.
- Read the code and the callers before you edit. Take the smallest complete change; reuse what exists; do not add a dependency for a few lines.
- Do not expand scope. If the brief is wrong or incomplete, say so and stop rather than guess.
- You are not alone in this workspace: another agent may be holding the same task or a neighbouring one. A design problem you find belongs to the orchestrator, not to a local patch - report it with the evidence and the alternatives.
- You are a persistent role specialist: you can receive several task briefs in this session. Keep your assigned role, treat each new message as one task, and do not spawn children.
- Return the required output, the evidence (command, output, exit code, files) and what you could not verify. A claim without evidence is not a result.
- **Some of the tools in your header are the HOST's, not your role's**: the MCP bridge (mcp__godot__*, mcp__playwright__*), Hindsight memory, the taskboard and the skills library are mounted at the host and inherited by every preset, so they do not widen the composition your role deliberately chose. Use them for the brief's work, and do not reach for one to do a job your role was given no tool for (a reviewer has read and bash but no write/edit).
- **No speculative tests: observe first, then persist the case.** Prove behaviour by running the product; when the behaviour is worth keeping, record it with \`case_record\` (automated needs testPath+runCommand and red-first evidence; otherwise documented-only with a reason). Do not write a test to guess at behaviour.
- Use \`task_note\` for significant findings and \`task_get\` to re-read your task. The orchestrator owns acceptance and the final report.
- BEFORE you report the task done, close the loop on what the work taught. If it produced a procedure that is not obvious from the code - a build incantation, a trap, an order of operations that cost a retry - call \`skill_inventory\`; if nothing covers it, call \`skill_evolve\` with the exact steps, the failure it prevents and this task as the evidence. Never record trivia, one-off facts or a secret. A task that found nothing reusable simply reports that; do not invent a skill to look productive.`

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
- Do not guess with tests: observe first, then persist the case. Run the product and quote what it produced; when the brief asks for a case, record it with \`case_record\` (red-first evidence for automated). A test file only for an observed case, and name the production behaviour it protects.
- Do not expand scope. If the brief is wrong, say so and stop.
- Use \`task_note\` for significant findings and \`task_get\` to re-read the task. The orchestrator owns acceptance.

${input.timebox === undefined ? '' : `Timebox: ${input.timebox}\n`}`
  if (brief.length <= limit) return brief
  return `${brief.slice(0, limit - 160)}\n\n[Brief truncated at ${limit} characters. The task fields remain authoritative; ask the orchestrator for the missing part.]`
}

/**
 * Resolve the route a delegated child runs on.
 *
 * The configured route is the default. A requested route must be complete and
 * enabled in Subagent model selection, because that setting is the harness's own
 * statement of which models an agent may hand to a child; accepting any
 * registered route would quietly turn this tool into a bypass of that policy.
 *
 * @param ctx - Cordis context.
 * @param args - Tool arguments.
 * @param defaults - The configured `{ provider, model }` child route.
 * @returns The route to spawn the child with.
 */
export function childRouteFor(ctx, args, defaults) {
  const provider = typeof args?.provider === 'string' ? args.provider.trim() : ''
  const model = typeof args?.model === 'string' ? args.model.trim() : ''
  if (provider === '' && model === '') return { ...defaults }
  if (provider === '' || model === '') {
    throw new Error('delegate_task: provider and model form one route; supply both or neither')
  }
  let selection
  try {
    selection = ctx.get('subagentModelSelection')
  } catch {
    selection = undefined
  }
  if (selection === undefined) {
    throw new Error(`delegate_task: ${provider}/${model} was requested but subagent model selection is not mounted; omit provider/model to use ${defaults.provider}/${defaults.model}`)
  }
  const { enabled, allowedModels } = selection.current()
  if (!enabled) {
    throw new Error(`delegate_task: child model selection is disabled; enable it under Plugins > Subagent > Model selection, or omit provider/model to use ${defaults.provider}/${defaults.model}`)
  }
  if (!allowedModels.some((route) => route.provider === provider && route.model === model)) {
    const offered = allowedModels.map((route) => `${route.provider}/${route.model}`).join(', ')
    throw new Error(`delegate_task: ${provider}/${model} is not an allowed child route; allowed: ${offered}`)
  }
  return { provider, model }
}

/**
 * Whether a role's existing child session can take this brief. Only the same tool set is
 * safe: a session keeps the composition it was created with, and a brief that promises
 * shell access to a session without one (or the reverse) is a lie the child cannot fix.
 *
 * @param knownAgent - The role row from the taskboard, if any.
 * @param preset - Preset id the delegation is about to use.
 * @returns True when the recorded session can be messaged instead of starting a new one.
 */
export function canReuseAgent(knownAgent, preset) {
  return knownAgent !== undefined
    && typeof knownAgent.sessionId === 'string'
    && knownAgent.sessionId !== ''
    && knownAgent.preset === preset
}

/**
 * Why a known role's session is not reused, or undefined when it is reused (or absent).
 *
 * @param knownAgent - The role row from the taskboard, if any.
 * @param role - Role name, for the sentence.
 * @param preset - Preset id the delegation is about to use.
 * @returns The note for the delegation result, or undefined.
 */
export function reuseNoteFor(knownAgent, role, preset) {
  if (knownAgent === undefined || canReuseAgent(knownAgent, preset)) return undefined
  if (typeof knownAgent.sessionId !== 'string' || knownAgent.sessionId === '') return undefined
  const previous = typeof knownAgent.preset === 'string' && knownAgent.preset !== '' ? knownAgent.preset : 'pre-preset'
  return `the existing ${role} session was created with the ${previous} composition, not ${preset}`
}

/**
 * Mark a task blocked with the code a taskboard write refused it for.
 *
 * The row is the record of WHY the delegation did not happen; a refusal that leaves no trace
 * makes the next reader start the same work again. Best effort by design: when the refusal
 * was `other_chat` or `not_found`, the block write is refused for the same reason and the
 * row is left exactly as it was.
 *
 * @param taskboard - The taskboard service.
 * @param cwd - Session workspace.
 * @param id - Task id.
 * @param code - The refusal code to record.
 * @param extra - Optional extra taskpatch fields.
 */
function noteRefusal(taskboard, cwd, id, code, extra = {}) {
  try {
    const current = taskboard.get(cwd, id)
    if (current === undefined) return false
    const patched = taskboard.update(cwd, {
      id,
      expectedRevision: current.revision,
      chatId: current.chatId ?? '',
      patch: {
        status: 'blocked',
        reason: `delegation refused: ${code}`,
        result: { risks: [`delegation refused: ${code}`] },
        ...extra,
      },
    })
    return patched?.ok === true
  } catch {
    return false
  }
}

/**
 * Whether this agent is the ROOT of its session tree (policy section + delegate_task).
 *
 * Depth alone is not enough: a subagent child can report `delegationDepth: 0` and still name
 * its parent (`parentSession`) or label itself `origin: 'subagent'` - measured in
 * @cc/dsh-notify's core, and a child that is treated as a root gets a second top to the tree
 * and the delegation tool. The same lineage signals the taskboard uses decide it here.
 *
 * @param agent - The agent a session was created for.
 * @returns True for a root session, false for a delegated child.
 */
export function isRootAgent(agent) {
  const header = agent?.session?.header
  const depth = Number(header?.delegationDepth ?? 0)
  if (Number.isFinite(depth) && depth > 0) return false
  if (typeof header?.parentSession === 'string' && header.parentSession !== '') return false
  if (header?.origin === 'subagent') return false
  return true
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
    description: 'Create one task in the workspace taskboard (or attach an existing one with taskId), render a self-contained brief, start a child on the role preset (its persona and tool set) and link the child session to the task. The role picks the tool composition: UX/UI, BACKEND, RESEARCH, REVIEWER, CRITIC, DOCS. A role outside those seven needs an explicit preset. Reuse a role from the catalog in your policy: a near-duplicate new role is refused unless forceRole is passed. One piece of work is one task - pass taskId when the task already exists. Use it for independent research, implementation or review work; not for a one-shot answer or for final integration.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short task title.' },
      role: { type: 'string', required: true, description: 'Specialist role, e.g. UX/UI, BACKEND, RESEARCH, REVIEWER, CRITIC, DOCS. The roles this workspace already has are listed in your policy section - reuse one of those exact names; all fitting tasks belong to it.' },
      preset: { type: 'string', enum: PRESET_IDS, description: 'Tool composition for the child. Omit to derive it from the role; pass it explicitly when the role is a specialty outside the seven (e.g. a migration under preset backend, or an adversarial pass over an algorithm with preset critic). AUDIT is not accepted as a name at all - use REVIEWER or CRITIC.' },
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
      provider: { type: 'string', description: 'Optional child route provider, paired with model. Omit for the configured default. Only a route enabled in Subagent model selection is accepted, and only when the default route is throttled or cannot do the job.' },
      model: { type: 'string', description: 'Optional child route model, paired with provider. Omit for the configured default. Highspeed variants are refused by the model guard.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (parent === undefined) throw new Error('delegate_task requires a calling agent')
      const role = typeof args.role === 'string' ? args.role.trim() : ''
      if (role === '') throw new Error('delegate_task: role is required (for example BACKEND, UX/UI, RESEARCH, REVIEWER, DOCS; reuse one role across tasks)')
      // A role names the task, a preset names the tools. Resolve it before any
      // taskboard write: a child started on the wrong composition does work that has
      // to be thrown away, and an explicit preset is the escape hatch for a role
      // outside the seven.
      // AUDIT IS REFUSED AS A NAME, not merely unmapped. Unmapped alone would still let
      // `role: "AUDIT", preset: "reviewer"` through, which is exactly the ambiguity: one label
      // whose tool set depends on the call. The board keeps the rows it already has as
      // history; new work must name the job.
      if (normalizeRole(role) === 'audit') {
        throw new Error(`delegate_task: "AUDIT" is two jobs, not one role. Use REVIEWER to judge a change (preset reviewer) or CRITIC to attack a running behaviour (preset critic); each keeps its own tool set, and an AUDIT name already on the board stays there as history.`)
      }
      const preset = typeof args.preset === 'string' && args.preset !== '' ? args.preset : presetForRole(role)
      if (preset === undefined) {
        throw new Error(`delegate_task: role "${role}" names none of the seven tool compositions (${PRESET_IDS.join(', ')}). Reuse one of those role names (CRITIC/QA/TESTER map to the adversarial tester), or pass preset explicitly when the role is a genuine specialty.`)
      }
      if (!PRESET_IDS.includes(preset)) {
        throw new Error(`delegate_task: "${preset}" is not one of the role presets (${PRESET_IDS.join(', ')}).`)
      }
      // Resolve the route before any taskboard write: an unavailable child route
      // must fail the call, not leave a task row that says a child is coming.
      const childRoute = childRouteFor(ctx, args, { provider: childProvider, model: childModel })
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
      // A ROLE LABEL KEEPS ONE TOOL SET, AND A LEGACY ROW IS NOT A ROLE.
      // Two measured lies this closes, both from ~/tasks/autolabel_pipeline (2026-11-11):
      //   - `AUDIT` was delegated once as a reviewer and once as a critic; the second
      //     registration rewrote the row's preset, so the catalog offered one role where two
      //     specialties had worked and the next reviewer brief landed on critic tools.
      //   - `DASHBOARD`/`BRIDGE`/`CORRECTIONS`/`FPS` rows predate presets, and continuing them
      //     re-created the name on a composition nobody chose.
      // Both are refused before a task row exists; forceRole is the explicit escape hatch.
      const knownPreset = typeof knownAgent?.preset === 'string' ? knownAgent.preset.trim() : ''
      if (knownAgent !== undefined && knownPreset === '' && args.forceRole !== true) {
        throw new Error(`delegate_task: role "${knownAgent.role}" is a legacy row from before role presets - its child's tool set is unknown, so it cannot be reused. Name this work with one of the seven roles (${PRESET_IDS.join(', ')}), or pass forceRole: true with an explicit preset to re-compose it deliberately.`)
      }
      if (knownAgent !== undefined && knownPreset !== '' && knownPreset !== preset && args.forceRole !== true) {
        throw new Error(`delegate_task: role "${knownAgent.role}" is already the [${knownPreset}] role in this workspace, and a role label keeps one tool set. ${knownPreset === 'reviewer' || preset === 'reviewer' ? 'REVIEWER judges a change while CRITIC attacks a running behaviour - use the role that owns this work. ' : ''}Pass forceRole: true only to deliberately re-compose the role.`)
      }
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
      // Tasks belong to a chat now, so a task id from somebody else's board is refused
      // here, before a child is started against work this chat cannot see.
      const attachId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
      const chatId = parent.id
      let task
      if (attachId !== '') {
        const existing = taskboard.get(taskCwd, attachId)
        if (existing === undefined) throw new Error(`delegate_task: no task "${attachId}" in this workspace`)
        const owner = typeof existing.chatId === 'string' && existing.chatId !== '' ? existing.chatId : existing.parentSessionId
        if (typeof owner === 'string' && owner !== '' && owner !== chatId) {
          throw new Error(`delegate_task: task "${attachId}" belongs to another chat's board; open a task in this chat instead`)
        }
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
          chatId,
          patch: {
            status: 'active',
            role,
            preset,
            priority: args.priority,
            // open -> active is refused by the ledger without an owner; the role is the
            // owner until linkChild replaces it with the child session.
            owner: { kind: 'agent', label: role },
          },
        })
        // A REFUSED ATTACH IS NOT A TASK. The old code kept `existing` and started a child
        // against a row this chat could not claim: orphan work, and the CAS race the update
        // reported was swallowed. The refusal is the answer; the row is blocked with its code
        // when the same guard allows the write (a foreign-chat row refuses that too, so it is
        // left untouched).
        if (updated?.ok !== true) {
          const code = typeof updated?.code === 'string' && updated.code !== '' ? updated.code : 'taskboard_refused'
          noteRefusal(taskboard, taskCwd, existing.id, code)
          return { ok: false, code, message: `delegate_task: the taskboard refused to attach task "${attachId}" (${code}); no child was started. The task was left untouched or blocked with that code.` }
        }
        task = updated.task
      } else {
        task = taskboard.create(taskCwd, {
          title: args.title,
          role,
          preset,
          objective: args.objective,
          scope: args.scope,
          nonScope: args.nonScope,
          acceptance: args.acceptance,
          parentId: args.parentTaskId,
          parentSessionId: parent.id,
          chatId,
          priority: args.priority,
          // The task is created before the child exists: it is open, not active. linkChild
          // moves it when the child is really running.
          status: 'open',
        }, 'orchestrator')
        // A REFUSED CREATE HAS NO ROW. `board_full` (the cap) used to fall through to a
        // brief and a child for a task that does not exist - the whole delegation ran
        // against `undefined`. The refusal is the result; nothing is spawned.
        if (task?.ok === false || typeof task?.id !== 'string') {
          const code = typeof task?.code === 'string' && task.code !== '' ? task.code : 'taskboard_refused'
          return { ok: false, code, message: `delegate_task: the taskboard refused to create the task (${code}); no child was started. Free a row (task_remove / task_close) or delegate onto an existing task with taskId.` }
        }
      }

      const subagentProvider = ctx.subagents.getProvider(provider)
      if (subagentProvider === undefined) {
        taskboard.update(taskCwd, {
          id: task.id,
          expectedRevision: task.revision,
          chatId,
          patch: { status: 'blocked', reason: `subagent provider "${provider}" is not registered`, result: { risks: [`subagent provider "${provider}" is not registered`] } },
        })
        throw new Error(`delegate_task: subagent provider "${provider}" is not registered`)
      }
      // Without preset support the child inherits the orchestrator's composition - no
      // shell, no write tool - and the task fails after the brief promised work. Refuse
      // before a child exists, for the same reason the provider check is here.
      if (subagentProvider.capabilities?.agentPreset !== true) {
        taskboard.update(taskCwd, {
          id: task.id,
          expectedRevision: task.revision,
          chatId,
          patch: { status: 'blocked', reason: `subagent provider "${provider}" cannot select the "${preset}" preset`, result: { risks: [`subagent provider "${provider}" cannot select the "${preset}" preset`] } },
        })
        throw new Error(`delegate_task: subagent provider "${provider}" cannot select a preset, so the child would inherit the orchestrator tool set; use a provider that supports agentPreset`)
      }

      const brief = renderBrief(task, args, maxBriefChars)
      const roleBrief = `You are the persistent ${role} specialist for this workspace. Responsibility: ${typeof args.roleDescription === 'string' && args.roleDescription.trim() !== '' ? args.roleDescription.trim() : role}. Your tool set is the ${preset} preset: if the work needs something that is not in it, stop and report that instead of improvising around it. Stay in this role across every task you receive; do not spawn subagents. Each new message is a separate task brief. Use task_note/task_get for the task you are handling; the orchestrator owns acceptance.`
      const agentOptions = subagentProvider.capabilities?.agentOptions === true
        ? { provider: childRoute.provider, model: childRoute.model, reasoningEffort: 'high' }
        : undefined
      if (agentOptions === undefined && (childRoute.provider !== childProvider || childRoute.model !== childModel)) {
        throw new Error(`delegate_task: subagent provider "${provider}" does not accept a model override; omit provider/model to use its own route`)
      }
      // A role's existing session is reusable only when it was created with the same tool
      // set. An older row predates the role presets (or was created under another one), and
      // reusing it would run this brief on a composition the brief does not describe: the
      // 2026-11-10 probe caught a "research" brief landing in a cordis session with a shell
      // and a write tool. Re-create instead, and say why.
      let childId = canReuseAgent(knownAgent, preset) ? knownAgent.sessionId : ''
      let reused = false
      let reuseNote = reuseNoteFor(knownAgent, role, preset)
      let childBrief = brief
      try {
        exec.signal.throwIfAborted()
        // Leave the intent on the timeline BEFORE the child starts. A delegation that dies
        // between creation and spawn used to leave a task that said only "Created" - the
        // signature measured in ~/tasks/3d on 2026-10-30, which reads like work in progress.
        try {
          const noted = taskboard.note(taskCwd, { id: task.id, chatId, text: `Delegating to ${role}${attachId === '' ? '' : ' (attached task)'}` })
          // THE FIRST WRITE PROVES THE ROW IS OURS. A note refused with `other_chat` or
          // `not_found` means the link would be refused moments later, after a child already
          // exists; stopping here is the only point where "no child" can still be true.
          if (noted?.ok === false) {
            const code = typeof noted.code === 'string' && noted.code !== '' ? noted.code : 'taskboard_refused'
            noteRefusal(taskboard, taskCwd, task.id, code)
            return { ok: false, code, message: `delegate_task: the taskboard refused the delegation note on task "${task.id}" (${code}); no child was started. Open a task in this chat instead.` }
          }
        } catch {
          // A diagnostic note is never control flow.
        }
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
              // The role's history is cross-chat on purpose: carry-forward must show what
              // this specialist did in earlier chats, which is exactly what a chat board hides.
              carryForward = renderCarryForward(taskboard.list(taskCwd, { all: true }), role)
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
              agentPreset: preset,
              ...(childCwd === taskCwd ? {} : { cwd: childCwd }),
              ...(agentOptions === undefined ? {} : { agentOptions }),
            },
            signal: exec.signal,
            delivery: 'parent',
          })
          childId = activation.childId
          // The ledger is the last word on identity: it refuses a label whose preset is already
          // recorded, and a child started against a row it refused is the orphan this path
          // exists to prevent. forceRole is passed through because the refusal above already
          // decided the switch was deliberate.
          const registered = taskboard.registerAgent(taskCwd, { role, label: role, sessionId: childId, taskId: task.id, chatSessionId: parent.id, preset, force: args.forceRole === true })
          if (registered?.ok === false) {
            try { ctx.subagents.interrupt?.(childId, { kind: 'ancestor', agent: parent }) } catch { /* reported, not hidden */ }
            taskboard.update(taskCwd, {
              id: task.id,
              expectedRevision: taskboard.get(taskCwd, task.id)?.revision ?? task.revision,
              chatId,
              patch: { status: 'blocked', reason: `role "${role}" already runs the ${registered.recorded} composition`, result: { risks: [`role "${role}" is recorded with preset ${registered.recorded}, not ${preset}`] } },
            })
            return { ok: false, code: registered.code ?? 'preset_conflict', message: `delegate_task: the taskboard refused to register role "${role}" with preset "${preset}" (${registered.code ?? 'preset_conflict'}: recorded ${registered.recorded}); the child was interrupted. Delegate under the role that owns this work, or pass forceRole: true.` }
          }
          if (reuseNote !== undefined) {
            try {
              ctx.logger?.warn?.(`delegate_task: role "${role}" re-created in this chat (${reuseNote})`)
            } catch {
              // A logger that cannot log must not fail the delegation.
            }
          }
        }
        const linked = taskboard.linkChild(taskCwd, { id: task.id, sessionId: childId, label: role, role, chatId })
        if (linked?.ok !== true) {
          const code = typeof linked?.code === 'string' && linked.code !== '' ? linked.code : 'taskboard_refused'
          // The child exists but the ledger would not record it. Stop it: a child working for
          // a task that does not know it exists is the orphan this whole path is about.
          try { ctx.subagents.interrupt?.(childId, { kind: 'ancestor', agent: parent }) } catch { /* a child that cannot be stopped is reported, not hidden */ }
          noteRefusal(taskboard, taskCwd, task.id, code)
          return { ok: false, code, message: `delegate_task: the taskboard refused to link child "${childId}" to task "${task.id}" (${code}); the child was interrupted and no work was started.` }
        }
        return {
          taskId: task.id,
          childId,
          role,
          preset,
          reused,
          title: task.title,
          status: 'active',
          ...(reuseNote === undefined ? {} : { roleRecreated: true, roleNote: reuseNote, carriedResults: knownAgent !== undefined }),
        }
      } catch (error) {
        // The task must not be left saying only "Created". The local revision was taken
        // before the timeline note above, so the compare-and-set below is read fresh; if it
        // still refuses, the reason goes into a note rather than disappearing.
        try {
          const current = taskboard.get(taskCwd, task.id)
          const patched = taskboard.update(taskCwd, {
            id: task.id,
            expectedRevision: current?.revision ?? task.revision,
            chatId,
            patch: { status: 'blocked', reason: `child start failed: ${error.message}`, result: { risks: [`child start failed: ${error.message}`] } },
          })
          taskboard.note(taskCwd, {
            id: task.id,
            chatId,
            text: patched?.ok === true
              ? `Delegation failed and the task was marked blocked: ${error.message}`
              : `Delegation failed; the status could not be set to blocked (${patched?.code ?? 'unknown'}): ${error.message}`,
          })
        } catch {
          // The task update is best-effort; the original failure is the one to report.
        }
        throw error
      }
    },
  })

  ctx.on('agent/created', ({ agent }) => {
    // Lineage, not depth alone: a subagent child can report depth 0 and still name its
    // parent (see isRootAgent).
    const isRoot = isRootAgent(agent)
    // The catalog is read once per turn, not once per request: a role created a minute
    // ago appears on the next turn, and every step of one turn shares one system prompt,
    // so the board writes those steps make cannot invalidate the provider's prefix cache
    // for the conversation. See freezePerTurn.
    const rootText = freezePerTurn(() => {
      try {
        const cwd = workingDir(agent)
        // The role catalog is a workspace fact (a name to reuse across chats); the debt
        // block is this chat's backlog, because that is what the human is watching and
        // what this orchestrator can act on.
        const chatId = agent?.session?.header?.id ?? agent?.id ?? ''
        const catalog = renderRoleCatalog(ctx.taskboard.agents(cwd))
        const debt = renderBoardDebt(ctx.taskboard.list(cwd, { chatId }))
        return [ROOT_POLICY, catalog, debt].filter((part) => part !== '').join('\n\n')
      } catch {
        return ROOT_POLICY
      }
    })
    if (isRoot) {
      // A turn boundary is the only point the block refreshes.
      agent.ctx.on('session/event', (session, event) => {
        if (session === agent.session && event?.type === 'turn/start') rootText.freeze()
      })
    }
    if (promptSections) {
      const base = ctx.systemPrompt.getSectionOrder('SUBAGENT_DELEGATION')
      agent.ctx.systemPrompt.section({
        name: isRoot ? 'deployment:orchestrator-policy' : 'deployment:specialist-policy',
        order: Number.isFinite(base) ? base + (isRoot ? 1 : 2) : (isRoot ? 121 : 122),
        text: isRoot ? () => rootText.text() : CHILD_POLICY,
      })
    }
    if (isRoot) {
      // THE ROLE GAP, CLOSED AT THE WIRE. `delegate_task` starts a child through
      // `startActivation`, which carries the role's agent preset (persona + tool
      // composition) and refuses a provider without preset capability. The generic
      // `subagent`/`subagent_fork` tools do neither: a root that calls them directly
      // creates a child with no preset, no role persona and the ROOT tool set, while the
      // taskboard label still says BACKEND (measured 2026-11-11: sessions a89c91e0,
      // 92a56489, 63ee9c52 were generic subagent children with no agent-preset/selected
      // event; two of them were task_link-ed as BACKEND). task_link only records metadata;
      // it cannot start or reconfigure a session, and a prompt that says "use
      // delegate_task" is not enforcement. This per-agent guard runs in the monotonic
      // `tools.guard` seam after `tools/pre-execute`, so no later listener can force-allow
      // the call; it is registered on `agent.ctx`, so it binds the root only and leaves a
      // specialist's own subagent capability (when its preset has one) untouched.
      // `delegate_task` does not pass through a tool call at all - it calls the subagents
      // service directly - so the legitimate path is unaffected.
      agent.ctx.tools.guard((exec) => {
        if (exec?.name !== 'subagent' && exec?.name !== 'subagent_fork') return undefined
        return [
          `Refused: ${exec.name} is disabled for the root agent of this deployment.`,
          'A child started here has no agent preset, no role persona and the root tool set, even if the task looks like a BACKEND/REVIEWER task.',
          'Use delegate_task with a role (BACKEND, UX/UI, RESEARCH, REVIEWER, CRITIC, DOCS, or your own catalog role) so the child starts on its role preset, gets its persona and restricted tools, and is linked to its task.',
          'For an existing task, pass taskId; for a one-shot answer, do the work inline.',
        ].join(' ')
      })
      agent.ctx.tools.register(definition)
    }
  })
}

export { ROOT_POLICY, CHILD_POLICY }
