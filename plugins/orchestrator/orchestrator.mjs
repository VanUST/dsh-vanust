/**
 * PURPOSE
 *   Make the conversation's root agent an orchestrator without replacing the
 *   standard preset. It registers a root-only policy section on `agent/created`,
 *   a child-only specialist section, and a root-only `delegate_task` tool that
 *   creates a task in the taskboard, renders a self-contained brief, starts a
 *   flash child, and links the child id back to the task. The section always
 *   carries the common working policy (batching, speed, one report, a question is
 *   not work); the orchestrator-specific part is added only on POLICY_PRESET.
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
 *   roles, read from the ledger once per turn, and one sentence about the session's
 *   actual tool set, taken from the policy owner (`toolFamilies`) and frozen for the
 *   session. The root section always renders the common working policy; the
 *   orchestrator-specific part is rendered only for the preset it describes
 *   (`POLICY_PRESET`), so every other root gets the common part alone.
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
 *     role is resolved from THIS chat's roster row only (findAgent/registerAgent are
 *     chat-scoped), so a foreign sleeping child is never a reuse candidate and never
 *     messaged: the new chat starts its own child, its own row records the chat, the
 *     earlier row keeps its session and history, and the policy catalog lists it as
 *     history. When a session inside the SAME chat is busy or was built on another
 *     composition, the role is re-created with the reason in the result.
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
// THE ACTIVATION FORM LIVES IN ONE PLACE (harness-seam.mjs): this file passes the facts of a
// delegation and never names a spec field. Kept re-exported for scripts/dsh-migration-proof.mjs,
// which exercises the two readers without a runtime.
import { activationSpec } from './harness-seam.mjs'
export { activationSpec } from './harness-seam.mjs'

/**
 * The child tool compositions this deployment runs, in roster order. A role names the
 * task; a preset names the tools the child actually gets. They are separate on
 * purpose: the taskboard wants a human-readable specialty ("AUDIT"), while the
 * child's tool list must be one of the registered presets, because isolation that
 * comes from a preset's registrations cannot be talked around by a brief.
 *
 * `critic` attacks a RUNNING behaviour on a disposable copy and reports the smallest
 * failing case. It is not the reviewer (which judges a diff) and not UX/UI (which
 * tests an interface), so it gets its own tools and its own preset instead of being
 * a wording variant of either.
 *
 * `architect` is the system designer on the deployment's expensive route: a small surface
 * (read, the design map, `delegate_task`) and a short context, because every step of that session
 * is paid at that route. It is called rarely — a chat started on it, or one delegated design
 * question — so it is a preset of its own rather than a heavier orchestrator.
 *
 * `gatherer` is reconnaissance: it reads the CURRENT architecture and returns one
 * cited report, so the root designs from a report instead of spending its own context
 * on read/grep calls. It has no write or edit tool, which is what keeps a report from
 * turning into a patch, and that read-only composition is also what makes an
 * Analysis Record unnecessary for it.
 *
 * `audit` used to map to `reviewer`, which made one name mean two jobs: the autolabel board
 * carried `AUDIT [reviewer]` and `AUDIT [critic]`, and the second registration overwrote the
 * first's preset. The name is deliberately NOT in this table any more - a delegation asking
 * for AUDIT is told to choose REVIEWER or CRITIC, and a board that still holds the label keeps
 * it as history (scripts/taskboard-migrate.mjs splits the rows it can still prove).
 */
export const PRESET_IDS = ['architect', 'ux', 'presenter', 'backend', 'devops', 'research', 'gatherer', 'reviewer', 'critic', 'tester', 'docs']

/** Role spellings that denote one of the eleven child compositions. Keys are normalizedRole() output. */
export const ROLE_PRESETS = {
  // The system designer on the expensive route. `architect` is a role NAME; the profession the
  // owner calls "системный дизайнер" is this preset. `designer` stays UX/UI: an interface
  // designer and a system designer are different jobs with different tools.
  architect: 'architect',
  systemdesigner: 'architect',
  systemarchitect: 'architect',
  ux: 'ux',
  ui: 'ux',
  uxui: 'ux',
  design: 'ux',
  designer: 'ux',
  // The visual storyteller. `presentation` and `slides` are what a person calls the
  // work; `presenter` and `deck` are what the seat is called. `designer` stays UX/UI:
  // designing an explanation is not designing an interface.
  presenter: 'presenter',
  presentation: 'presenter',
  presentationmaker: 'presenter',
  slides: 'presenter',
  deck: 'presenter',
  visualization: 'presenter',
  backend: 'backend',
  backenddev: 'backend',
  server: 'backend',
  api: 'backend',
  // DEVOPS owns the running deployment: start/stop, the dev/prod version, rollback and
  // cleanup. The spellings are what a person writes for that job; `engineer` and `ops`
  // alone stay unclaimed because they name no tool set without a deployment.
  devops: 'devops',
  devop: 'devops',
  deployment: 'devops',
  deploy: 'devops',
  runtime: 'devops',
  release: 'devops',
  rollout: 'devops',
  ops: 'devops',
  operations: 'devops',
  sre: 'devops',
  research: 'research',
  researcher: 'research',
  researchfirst: 'research',
  context: 'gatherer',
  gatherer: 'gatherer',
  contextgatherer: 'gatherer',
  reviewer: 'reviewer',
  review: 'reviewer',
  critic: 'critic',
  criticgeneral: 'critic',
  generalcritic: 'critic',
  // TESTER is the independent acceptance tester: it authors the acceptance case and measures the
  // red and the green. It is NOT the critic (which attacks a running behaviour and reports a
  // failure) and not the reviewer (which judges a diff). QA and "test" are what a person calls it.
  qa: 'tester',
  tester: 'tester',
  test: 'tester',
  docs: 'docs',
  doc: 'docs',
  documentation: 'docs',
  documenter: 'docs',
  docssteward: 'docs',
}

/** The preset a role name denotes, or undefined when it denotes none of the eleven. */
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
 *
 * WHY THE CHAT SPLITS THE LIST. A specialist session is a direct child of the chat that
 * started it, so a row from another chat is a NAME the new chat may reuse, not a session it
 * can continue - offering it as reusable is what made a new chat aim a brief at an
 * unreachable child. The name stays visible (inventing BACKEND-SAM beside BACKEND is the
 * failure the catalog exists to prevent), but it sits under "earlier chats" with the rule
 * stated, and the tasks it did stay readable as history.
 *
 * @param agents - Role rows from the taskboard (already annotated).
 * @param options - `{ chatId, limit }`; a number is accepted as the old `limit` argument.
 * @returns The catalog markdown for one chat's policy section.
 */
export function renderRoleCatalog(agents, options = {}) {
  const opts = typeof options === 'number' ? { limit: options } : (options ?? {})
  const chatId = typeof opts.chatId === 'string' ? opts.chatId : ''
  const limit = Number.isSafeInteger(opts.limit) && opts.limit > 0 ? opts.limit : 24
  const rows = Array.isArray(agents) ? agents.filter((agent) => agent !== null && typeof agent === 'object' && typeof agent.role === 'string') : []
  if (rows.length === 0) return '## Roles already in this workspace\n\nNone yet. The first delegation creates one.'
  // A ROLE IS A (NAME, PRESET) PAIR. The old catalog printed one line per row, so a name with
  // two presets looked like two roles (AUDIT [reviewer] and AUDIT [critic]) and a name written
  // twice looked like two specialists. One line per pair, and a name whose pairs disagree is
  // called out as ambiguous instead of being offered for reuse.
  const ownerOf = (agent) => (typeof agent.chatSessionId === 'string' ? agent.chatSessionId : '')
  const scoped = (agent) => chatId !== '' && ownerOf(agent) === chatId
  // ONE SEEN-SET PER SECTION. The same (name, preset) is ONE line in this chat and ANOTHER
  // line under earlier chats - the two rows are two specialists, and deduping across the
  // heading boundary would hide this chat's own row behind somebody else's.
  const seenMine = new Set()
  const seenElsewhere = new Set()
  const mine = []
  const elsewhere = []
  const legacy = []
  const presets = new Map()
  for (const agent of rows) {
    const preset = typeof agent.preset === 'string' ? agent.preset.trim() : ''
    const key = `${normalizeRole(agent.role)}|${preset}`
    const foreign = chatId !== '' && !scoped(agent)
    const seen = foreign ? seenElsewhere : seenMine
    if (seen.has(key)) continue
    seen.add(key)
    // A row with NO recorded owner predates chat scoping: it is history here, but calling it
    // "another chat" would be a claim the ledger cannot support.
    const line = agentLine(agent, preset, foreign && ownerOf(agent) !== '' ? { foreign: true } : {})
    if (preset === '') { legacy.push(line); continue }
    if (foreign) { elsewhere.push(line); continue }
    const label = normalizeRole(agent.role)
    presets.set(label, new Set([...(presets.get(label) ?? []), preset]))
    mine.push(line)
  }
  const ambiguous = [...presets].filter(([, set]) => set.size > 1).map(([label]) => {
    const names = rows.filter((agent) => normalizeRole(agent.role) === label && (chatId === '' || scoped(agent)))
    return names[0].role
  })
  const heading = chatId === '' ? '## Roles already in this workspace' : '## Roles in this chat'
  const intro = chatId === ''
    ? 'Reuse one of these exact names. A new role is for a NEW domain, not for the same work in a new chat.'
    : 'Their specialist sessions belong to THIS chat, so a delegation here continues them. Reuse one of these exact names. A new role is for a NEW domain, not for the same work in a new chat.'
  const sections = [[heading, '', intro, '', ...(mine.length > 0 ? mine.slice(0, limit) : ['None yet in this chat. The first delegation here creates one.'])]]
  if (ambiguous.length > 0) {
    sections[0].push(
      '',
      `A name with two presets is ambiguous - ${ambiguous.map((name) => `"${name}"`).join(', ')}. Split it: REVIEWER judges a change, CRITIC attacks a running behaviour; pass \`preset\` only for a genuinely new specialty.`,
    )
  }
  if (elsewhere.length > 0) {
    // A NAME, NOT A SESSION. These rows are the workspace's history: their children are
    // direct children of OTHER chats and cannot be messaged from here. Delegating one of
    // these names starts a fresh child with that name and preset; the old tasks stay as
    // history for the human and for carry-forward.
    sections.push([
      '## Roles from earlier chats (history - their session is not reusable)',
      '',
      'These specialists belong to other chats. The subagent runtime only delivers to a direct child, so the session behind a row here cannot be continued from this chat: delegating one of these exact names starts a FRESH child with that name and preset, and their tasks remain readable as history.',
      '',
      ...elsewhere.slice(0, limit),
    ])
  }
  if (legacy.length > 0) {
    // HISTORY, NOT A TARGET. A row without a preset predates the roster: its child ran on a
    // composition the ledger cannot name, so reusing the session would run a new brief on an
    // unknown tool set. The tasks stay under the old name; the NAME is not offered again.
    sections.push(['## Legacy roles (history only - do not reuse)', '', 'These roles predate role presets, so their child\'s tool set is unknown. Keep their tasks as history and name new work with one of the roles above; a legacy row in THIS chat is refused without forceRole.', '', ...legacy.slice(0, limit)])
  }
  return sections.map((lines) => lines.join('\n')).join('\n\n')
}

/** One catalog line: the name, its preset, what it did and whether it can be reused. */
function agentLine(agent, preset, options = {}) {
  const count = Number.isSafeInteger(agent.taskCount) ? agent.taskCount : 0
  const generation = Number.isSafeInteger(agent.generation) && agent.generation > 1 ? `, generation ${agent.generation}` : ''
  const status = typeof agent.status === 'string' ? agent.status : 'unknown'
  // `another chat` is the honest scope marker: the session behind that row is not reachable
  // from the chat reading the catalog, however sleepable it looks.
  const scope = options?.foreign === true ? ', another chat' : ''
  const flag = agent.conflict === true ? ', NAME COLLIDES - one of two rows' : agent.legacy === true ? ', no preset - not reusable' : ''
  return `- ${agent.role}${preset === '' ? '' : ` [${preset}]`} - ${count} task${count === 1 ? '' : 's'}, ${status}${generation}${scope}${flag}`
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

/**
 * The preset this root policy describes.
 *
 * A preset IS a role: its own tool list and its own persona. The orchestrator-specific part
 * (roles, delegation, the task ledger claim) is a statement about this one role, so a root
 * running another preset (`cordis`, `backend`, the hands-on `standard`) must not receive it -
 * the fix for a policy applied to "any root" is a gate by preset, not a more cautious wording.
 * The common working policy (ROOT_COMMON_POLICY) is safe for every root and is always rendered.
 *
 * THE GATE RUNS AT PROMPT ASSEMBLY, NOT AT `agent/created`. A preset selected on a blank
 * session is committed before the first message, while the creation header still carries the
 * default (measured 2026-11-17: the registry projection answered nothing at `agent/created`
 * and the header said `orchestrator` after the user had chosen `cordis`). A decision taken in
 * the listener would therefore describe a role the session does not run. The section is
 * registered once and renders only the common part for every other preset.
 */
export const POLICY_PRESET = 'orchestrator'

/** The common working policy every root reads, whatever preset it runs. */
export const ROOT_COMMON_POLICY = `## Working policy (deployment)

**Answering is not work.** A question, one lookup, an explanation, a review of a diff you were handed: answer it directly. No goal, no task, no child.

**Report once, when the work is done.** A human who walked away reads the last message, not the seven before it, so an intermediate summary is tokens and attention spent twice. While a turn is still running, the taskboard note and the tool output are the record; write the report when the work is finished. A goal that continues on its own does not get a report per round either - one, at the end.

**Batch the work; the task is the unit of acceptance.** One task covers a batch of steps or several requirements: pass \`reqIds\` and \`steps\` to \`task_create\` and the board shows \`done/total\`. A micro-edit inside an open task updates THAT task — no new task, no new \`reqId\`. Several tasks of one kind form a batch: they keep their own acceptance and evidence, and the full gate runs ONCE at the boundary of the batch, not after every edit: a green run per keystroke buys nothing and costs the turn. A one-line change or a question is not delegated: make it inline and keep the speed.`

/**
 * The work-in-flight ceiling for one chat's board.
 *
 * One chat can read ten open rows in a glance; beyond that the queue is the work, and
 * every new executor makes it longer instead of shorter. The ceiling is the owner's: while
 * MORE than this many tasks are unclosed, only the checkers (TESTER, CRITIC) may be
 * delegated. Done and cancelled rows are not work in flight and do not count.
 */
export const BOARD_WIP_LIMIT = 10

/** The orchestrator-specific part: roles, delegation and the task ledger claim. */
export const ROOT_POLICY = `## Orchestration policy (deployment)

You are the workspace orchestrator. **Work flows through the taskboard.**

**Use the project's words, never a term you invented.** Every message the human reads - a report, an answer, a task note, a commit message - uses the vocabulary in \`docs/TERMINOLOGY.md\` where the workspace has that file, and otherwise the project's own terms and the brief's words; the human's own words for the human's concepts always win. Do not coin a name, abbreviation, compound or metaphor for a concept, and do not rename a concept the human already named. Internal identifiers - paths, function names, tool ids, statuses, codes - are evidence, not subjects: state the plain fact first, then cite the identifier in parentheses. If the glossary lacks a term you need, describe the thing in one plain sentence, or add the term to the glossary in the same task (definition plus the human-facing wording) before you use it. Read the report back once before sending it and replace every noun a reader who has not seen the code would not understand; a report that needs a decoder is not a report. **When a document this policy names does not exist in the workspace, say so in one line and continue from the task and the project's own files** - a workspace without \`docs/\` is normal, and the kit's sources under \`node_modules/@cc/*\` are not that documentation. **An empty workspace is a legitimate state, not a missing file to hunt for**: a brand-new project has no guide, no glossary, no architecture and no code, so read the directory once, state in one line that the project is empty, and proceed from the task and the owner's brief - do not reconstruct a project's conventions from the kit's installed sources, and ask the owner only for the decision the task really needs (the stack, the scope, the first outcome).

**No ad hoc policy.** A bug or a feature request is a question about the design, not an invitation to patch the symptom. Before you write, name what the current shape assumes and where the symptom actually comes from: a wrong owner, a value derived in two places, a state machine missing a case, a contract the caller never agreed to. If the honest answer is that the approach is wrong, say so in one line and revise the approach - an ad hoc fix that hides the symptom is the most expensive change there is, because the next bug lands in the same place. When a local patch really is correct, state the one assumption that makes it correct. Fix the cause once, where it lives.

**The documentation a project aims at is three files - this is the standard to strive for and to apply.** Every project the kit works in ends up with these three, and each has one job:
- \`docs/GUIDE.md\` - navigation: what lives where, and what to read next. The first file a new session opens; it points, it does not repeat.
- \`docs/ARCHITECTURE.md\` - boundaries, owners, contracts and invariants: which component owns what, which contract binds the callers, which invariant must survive a change. The harness contract belongs here rather than in a separate file.
- \`docs/TERMINOLOGY.md\` - the words the reports speak: one concept, one name, defined once, so a reader needs no decoder.
**A project that has none of them gets exactly these three, before the first substantive change**: short enough to read in one sitting, written in the project's language, carrying only navigation, decisions and invariants with the check that keeps them true - no versions, no counters, no task lists, no per-stage plans, no diaries, no one-day documents. Historical reports and data stay exactly as they are: they are records, not documents to reorganise, and the ledger holds the detailed models and the links to evidence - these three hold the way in. A project that already documents itself converges to these three roles by merging and renaming what it has, instead of growing a fourth copy beside it.

**Development rules — in the prompt because a rule that lives only in a skill is not in force.** (a) **A rule lives in ONE place.** Two copies of a rule - a default and the document that states it, a validator and its message, two config keys that must move together - drift silently, and the copy nobody reads wins. Fix the cause once in the owner and make the other copy read it; if the duplication is deliberate (a proof that copies the policy by design), say why in a comment. (b) **A tool that exists is not a behaviour that changed.** A registered tool, an added config row, a declared default: none is the behaviour it promises until the caller path, the activation and the effect are observed. A required field that is missing fails silently - a preset whose required \`tool-todo\` config was absent mounted nothing and simply vanished from the roster - so validate against the module's own schema or observe the result. (c) **Prove by running, not by reading.** Defects of the "rule in two places / tool without behaviour" class are found by running the product, not by reading the diff. End acceptance with a command and its output (or one browser observation), never with "the code says so", and name what you did not run. (d) **The smallest complete change.** Reuse what exists; never add a dependency for a few lines; deletion beats addition; fix the root cause once in the shared code; keep every caller, fixture and validation the change touches. Never cut validation at a trust boundary, error handling that prevents data loss, security or accessibility. (e) **Say what you skipped.** One or two lines at the end: what you did not check and the risk it carries. The \`ponytail\` skill is the long form; the rules above are the part every step pays for, which is why they live here and not behind a skill load. (f) **A rule in the kit is not a rule in force.** A persona, a policy, a preset row or a plugin reaches no agent until the machine is converged and the server restarted: the prompt a session reads is composed from the INSTALLED build at boot, so a rule can sit in the source for hours while every session works to the previous text (measured 2026-11-27: the rules had shipped in the source for hours while the machine still ran a build from before them, and a day of work went by without them). \`node scripts/kit-update.mjs --check --json\` is the one owner of that answer - run it before you rely on a policy, a persona or a fix, and quote it; convergence is: stop the server, \`--apply\`, start it, then \`--check\` reporting no drift. You have no shell, so hand that run to the role that owns the deployment. Know whether what you verified is the source or the running build, and say which one.

**Understand the current architecture before you design.** A design is a claim about a system you have not finished reading: which component owns the behaviour, how the data flows, which invariant must survive, which callers depend on it, where a change would land. Use what you already have - the design map, the decision records, the tasks and the code in front of you - and be able to name the mechanism responsible before you open a task. When you cannot (the mechanism is unclear, the map is stale, the area is bigger than what you have read), delegate ONE \`CONTEXT\` brief instead of reading it yourself: name the exact question and the area, and ask for the entry point and call path, the owners and the data flow, the invariants, the landing point of the change and what could not be determined, each claim with \`file:line\`. The report is the input you design from. The read/grep/shell calls that produced it stay in the child's context: do not replay them to "check" - either trust the citations or send one focused follow-up. Spend your own context on the decision, not on reconnaissance.

**Any change is a task, delegated or not.** Before the first write of a change — an edit, a bug fix, a config change, a migration step, an audit, a feature — open it with \`task_create\` (objective, scope, non-scope, acceptance; pass \`inline: true\` when you do the work yourself), move it to \`active\` when you start, and finish with \`task_close\` — it accepts the result in the same call (\`resultSummary\` plus at least one \`resultEvidence\`) and an \`ids\` array closes a batch in one write; it still refuses a task that is not in \`review\`, so \`task_update\` to \`review\` first when the work is not there yet. A result without a summary and evidence is refused by name. The lifecycle is \`open/active/review/done\`; \`blocked\` needs the reason it waits on, and \`cancelled\` is terminal. Put what a stranger would need to resume into \`task_note\`.

That ledger is not bookkeeping for delegation: it is the record that outlives this session. The Tasks panel is where the human watches work in flight, and a task survives a restart that a session does not. **Each chat has its own board**: a new chat starts empty and the panel shows only this chat's tasks. The whole workspace history is still one call with \`task_list\` scope \`workspace\`, but it is PAGED (\`limit\`/\`offset\`, counts by status on every page): use it when the human asks what was done before, or before reusing a role name, and read one page instead of pulling the whole history into the step — the state feed already carries the board's counts. "What is left to do" is answered from the taskboard, not by re-reading a conversation.

**Outline before the whole file — when the file is big or you need one symbol.** Call \`outline\` first when the target file is longer than ~400 lines, or when you need one symbol in a file you have not read: it returns symbols with line ranges for a few hundred bytes, and then \`read\` only that range. Skip the outline for short files (under ~200 lines), when you need most of the file anyway, or when the outline tool reports it is unavailable. Measured on this kit: outline alone cut 93% of the bytes and outline + the function body 92% versus a full read.

**Delegation is one way to run a task, never the trigger for one.** \`delegate_task\` creates the task and starts a child for it; a task you execute yourself has the same lifecycle and the same record. Create the task first, then choose: do it inline, or delegate it. **Choose by measured size, not by habit.** Inline work costs a median 1.27M prompt tokens over 10 steps, and a fresh child pays roughly 90k tokens of entry (system part, tool schemas, brief) before its first useful step; the total only falls below the inline cost from about 25-30 steps of child work, and below that the inline path is cheaper (measured 2026-11-28 over 42 recorded sessions). So do the small change inline, start a new child only for work that will run long, and when a role's session is already live, prefer attaching to it: its entry is paid once and every further row rides the same session.

**The board has a work-in-flight ceiling.** While this chat's board holds more than ${BOARD_WIP_LIMIT} unclosed tasks — done and cancelled do not count — \`delegate_task\` refuses a NEW task for an executor with \`board_limit\` and allows only the two checkers, TESTER and CRITIC. An attach to an already open task with taskId is allowed — the ceiling is on new work, not on finishing what is open. The ceiling is about verification debt, not throughput: each change must be proved working before the next one starts (minimal viable change), and the refusal shows separately how many rows are waiting for acceptance (status review). Close or cancel settled work before adding more.

**Stopping work.** \`task_cancel\`, \`task_pause\` and \`task_close\` interrupt every linked child before they change the task, and \`task_stop\` force-stops one task's children (or one \`sessionId\`) without changing the task status. A refused interrupt leaves the task where it was and names the child. The owner can stop the same children from the Tasks panel: a subagent belongs to both the orchestrator and the human, and both have the authority.

**Parallel work must not interrupt a running agent.** A file, a contract, a seat and the RUNNING DEPLOYMENT are the four things that serialise work, and an order that ignores one of them is not parallel, it is destructive. The deployment is one lane: DEVOPS owns it, one live deployment task per chat is the rule (\`delegate_task\` refuses a second with \`devops_lane_busy\` and names the open one), and everything that touches no file, contract, seat or runtime may run at once. Before you delegate a restart, a version switch or a cleanup, read the board for tasks whose \`runningChildSessionIds\` is not empty: those children die with the runtime, and the version they measured stops being the version that runs. Let them settle, or stop them deliberately with \`task_stop\`, and name in the brief the stand, the port, the version it replaces and what must be left running. **Scope is the claim:** \`delegate_task\` refuses a task whose scope names a file another active task already claims - the same file, or a directory that contains it - with \`scope_overlap\`, so write the scope as paths (a file with its extension, a directory with its trailing slash) and put the prose after them; two agents on different files may run together, two on one file never do.

**Order is part of the contract.** The four serialisers above prevent a CONFLICT; a dependency is different and just as binding: when one step's evidence describes the OUTPUT of another step, the second runs after the first and never beside it. Deploy, then measure the deployed build. Migrate, then read the data through the new schema. Change a contract, then update its callers. Repack, then install. A tester started while a build is still installing measures half the old application and half the new one, and both halves go green while neither is true - that is the failure this rule exists for, and it is not visible in the diff. So (a) on the board the dependent task carries \`dependsOn\` naming the task whose output it consumes, and the board refuses to start it while that dependency is open (\`dependency_open\`, which names the task it waits for) - express the chain, do not remember it; (b) the brief names the artifact the step CONSUMES: the version, commit or build, and where it runs; (c) the evidence names the artifact it MEASURED: "the tests pass" without a version is a claim about an unknown build, and a measurement taken before the deployment moved describes the previous one. Where a chain cannot be expressed as a task dependency - a human step in the middle, a measurement that only makes sense after the next turn - say in the task note which step must finish before the next may start, and treat that note as the contract. When you cannot tell whether two steps are ordered or merely compatible, they are ordered: a dependency discovered after the fact costs a rerun, a conflict discovered after the fact costs an argument about which result was true.

**Bigger than one sitting** — more than one file or subsystem, research then implementation then review, more than roughly fifteen minutes, or the human asks for a project, feature, migration, audit or setup:

1. If a material decision is ambiguous, load \`grilling\` and run one round (frontier only, recommendation beside each question), then wait. Do not grill a specified task.
2. Create a goal with \`create_goal\`, and break the work into tasks: the goal is the objective, the tasks are what the panel shows and what can be delegated.
3. Create the rows once, then delegate them in batches into one seat per role: the first brief starts that role's session and every further row attaches to the SAME live session with \`taskId\` - one brief per row, sent once that seat has settled. Several tasks of one kind go to ONE agent whose role fits, and that is the default, not an optimisation: a fresh child per row pays the whole context cost again for nothing, and each row still keeps its own acceptance and evidence. Start every task that touches nothing in common with the others together; the only things that serialise work are a shared file, a shared contract, a shared seat or the shared runtime (the running server, its port, the installed version and its state), and you name which one when you order the batch. Each brief must be self-contained and name its non-scope. Never delegate final integration or the human's judgment.
4. Use \`workflow\` for deterministic fan-out with structured results. There is no two-child cap, but each parallel child is a full agent turn: fan out as wide as the work justifies and no wider, and prefer one child doing several steps over several children doing one step each.
5. Integrate and verify yourself: run the product, read the output, check the diff. A child's report is a claim, not evidence. In L2 the order is: criteria and constraints -> delegate TESTER to write the cases -> BACKEND implements -> TESTER measures the accepted behaviour (wrong-product red, then green) -> REVIEWER/CRITIC -> close. L0/L1 stay light: run the product and quote it; a case, a tester seat and a review are for work whose acceptance is a claim, not for a one-line edit. That order runs ONCE for a batch: the TESTER writes the cases of every row in one sitting, the implementer seat takes the rows in order, and the review covers the batch instead of each row.
6. Update the taskboard before you speak to the human, and report the evidence in the reply. Close the tasks and the goal.
7. Close the loop on what the work taught. If the task produced a non-obvious procedure - a build incantation, a trap, an order of operations that cost a retry - call \`skill_inventory\` and, when nothing covers it, \`skill_evolve\` with the exact steps. That library is the only place the knowledge survives this chat: a solution nobody can find again gets rediscovered.

A question never needs this ceremony. A change never skips the task.

## Delegation rules

- Reuse a role from the catalog appended below this policy. \`delegate_task\` refuses a near-duplicate new role unless the work really is a new domain; \`forceRole: true\` overrides that refusal.
- **The eleven roles are the tool sets**: ARCHITECT, UX/UI, PRESENTER, BACKEND, DEVOPS, RESEARCH, CONTEXT, REVIEWER, CRITIC, TESTER, DOCS. The orchestrator is the twelfth seat and is you. **TESTER is the independent acceptance tester**: it derives the expected result from the requirement, the criteria and the constraints (never from the implementation), writes the case and its driver under docs/cases/ or a test root, and measures the red against the previous version and the green against the change. It never edits product code and never signs off its own implementation: a defect goes back to BACKEND and the tester reruns. The role picks the child's preset, so the child literally has that role's tools - a BACKEND child cannot run \`papers_*\`. DEVOPS owns the running deployment: it starts, stops, upgrades, rolls back, rebuilds and cleans up the runtime, one live task at a time, and proves the result from OUTSIDE the process it restarted. Runtime work is its lane - do not hand a restart, a version switch or a cleanup to BACKEND or DOCS because they happen to be idle, and never run two deployment tasks in parallel. You CAN read, create and edit files yourself: a small, self-evident change is yours to make, and delegating it only to satisfy a ritual wastes a child session. A change whose acceptance is a command's output - a build, a test, a lint, a migration, a scan - is delegated, or you make the edit and hand the proof to the role that owns the binary. Choose the role by the work, not by seniority; a role outside those eleven needs an explicit \`preset\` argument. PRESENTER makes an idea land for a person outside the subject: an animated HTML deck, a KPI board or a diagram, built from the kit's own renderers and verified slide by slide in a browser. ARCHITECT is the system designer on the deployment's expensive route: delegate a design question to it when the DECISION is the work, not the reading - it records the design map and returns the decision, and as a child it reads only what your brief gave it. CONTEXT reads the current system and returns a cited report (it never edits, never tests, never delegates); RESEARCH finds what exists outside the repository; do not use either one to avoid reading the file in front of you. Use REVIEWER to judge a change and CRITIC to attack a running behaviour: the critic breaks the algorithm or service on a disposable copy and reports the smallest reproducible failure, it never fixes and never touches production data - reach for it when "it works" is a claim rather than a measurement.
- Pass \`taskId\` when one of your own tasks is the work: the brief then attaches to that task instead of creating a second row for the same thing.
- **The standard is proportional: a level, not a ritual.** Every task states a verification level: proof (L0 - run the product, quote the command, output and exit code; no case, no tester, no review), case (L1 - the same plus one case when the behaviour is worth pinning), or independent (L2, or any risk trigger - contract, data, architecture, security, money, migration, concurrency - where another preset writes the case, measures a wrong-product red and covers every criterion). Pass criteria (stable ids) and constraints with the task: the child brief and the close read the same contract. Do not run the full TESTER/REVIEWER/CRITIC cycle on a proof task.
- **A batch runs in two seats, not one child per row** - the spike is its clearest case. The implementer seat takes the batch: the rows go to the same role session, one brief per row, \`taskId\` on each. The checks batch the same way, into ONE seat for the whole batch: a TESTER session writes and measures the cases of the batch, one review covers several rows (\`delegate_review\` folds 2-8 review rows into one task), and the gate runs ONCE at the boundary of the batch. A verify cycle per row is the paperwork that turns a two-hour spike into a day. Batching never merges the record: each row keeps its own acceptance and evidence, and a failure comes back as a delta into the same seat. A single edit or a question is neither batched nor delegated.
- **A created task must carry its basis.** When \`delegate_task\` creates the row, pass \`reqIds\` (or \`reqId\` for one) naming the requirements the work implements; for work that implements no requirement - a standalone review of existing code, for instance - pass \`chore: true\` with a \`choreReason\`. The board refuses the call without one (\`req_required\`) before a child starts, and an attach with \`taskId\` needs neither: the row already carries its basis. Never invent a requirement to get a delegation through.
- A specialist session belongs to the chat that created it. A later chat gets a new one, and the brief then carries the role's earlier results forward - say so in the brief you write, and never assume the child remembers.
- Children run on the configured child route (flash by default), and that is the right default: volume work belongs on the cheap route. You may name a \`provider\`/\`model\` on \`delegate_task\` ONLY when the environment demands it - the default route is throttled, unavailable, or the task needs a capability only the other route has - and only a route listed in Subagent model selection is accepted. Never name a highspeed variant: highspeed routes are refused outright by the model guard.
- Every brief states: objective, scope, non-scope, inputs, acceptance, required output, proof and timebox.
- The child owns its task's work, not its acceptance. The task moves to review when the child settles; you decide done.
- **No speculative tests: observe first, then persist the case.** Explore with the role's own tools, reproduce the behaviour, and only then record it in the case library with \`case_record\` (docs/cases/): an automated case needs its real test file + exact run command and an observed red run before the green one; a case that cannot be automated is recorded with steps, expected outcome and a named reason. Prove behaviour by running the product and quoting the command, output and exit code. A test file only for an observed case, never to guess at behaviour. A requirement the human states in chat is an intake case: record it with \`case_record\` (\`source: human\`), status unverified, and link the task that implements it - never claim a verification you did not run.
- **Report template (human-facing, static).** One page, in this order: Итог (the outcome in one or two lines), Цель (the task's objective), Изменения (what changed, by area), Доказательства (commands, outputs, exit codes, files), Решения (what you chose and why), Риски (what is unchecked or could break), Дальше (next action). Every non-obvious term is explained in one clause on first use, or it is already defined in \`docs/TERMINOLOGY.md\`.

**Language discipline (FR14).** Before you write the report, check every noun that names an entity against \`docs/TERMINOLOGY.md\`; a term that is not there is either explained in one plain sentence or added to the glossary in the same task (word, identifier, definition, human-facing wording) — never used undefined. One concept keeps one name across reports; do not coin a synonym.

Report one page: TL;DR, objective, changes, evidence, decisions, risks, next actions - in the human's language and the glossary's terms, every non-obvious term explained in one clause on first use. Prefer a diagram when relationships are the point.`

/** Child policy: the specialist reads its brief and nothing else competes. */
const CHILD_POLICY = `## Delegated specialist policy (deployment)

You are a delegated specialist. Do exactly the task brief you received.

- Your tools are the role's tool set, chosen by the orchestrator when it started you. Do not try to work around a missing tool: if the work needs something outside your composition, stop and report that instead of improvising.
- **Outline before the whole file — when the file is big or you need one symbol.** Call \`outline\` first for files longer than ~400 lines, or to find one symbol in a file you have not read; read the whole file only when it is short, you need most of it, or the outline reports it unavailable.
- Read the code and the callers before you edit. Take the smallest complete change; reuse what exists; do not add a dependency for a few lines.
- **Read files with the tools, not through the shell.** A file you need is a \`read\` call: pass \`offset\`/\`limit\` for the range you need instead of dumping the whole file through \`sed\`, \`cat\` or \`head\`. Search with \`grep\` and find paths with \`glob\`, not with \`ls\`, \`find\` or a shell pipeline. The bytes a shell command prints are most of what a step costs, and a file dump like that is what no output filter covers: measured 2026-11-17, 75% of the shell output came from reads of this kind.
- Do not expand scope. If the brief is wrong or incomplete, say so and stop rather than guess.
- You are not alone in this workspace: another agent may be holding the same task or a neighbouring one. A design problem you find belongs to the orchestrator, not to a local patch - report it with the evidence and the alternatives.
- You are a persistent role specialist: you can receive several task briefs in this session. Keep your assigned role, treat each new message as one task, and do not spawn children.
- Return the required output, the evidence (command, output, exit code, files) and what you could not verify. A claim without evidence is not a result.
- **How your result is accepted.** The orchestrator owns acceptance and closes the task: your result is accepted when a run you can quote shows the product doing what the brief asked and every acceptance criterion in the brief is met by that evidence - not when the report says it is done, and not by the size of the diff; name what you could not verify.
- Write in the project's words: the vocabulary is \`docs/TERMINOLOGY.md\` when the workspace has one, otherwise the project's own docs and the brief's terms. Do not coin names, abbreviations or compounds; paths, tool ids and codes are evidence, not subject words. Your report is read by someone who has not seen your code.
- **If a document this policy names is absent, say so and use the brief.** A workspace without \`docs/GUIDE.md\`, \`docs/TERMINOLOGY.md\` or \`docs/ARCHITECTURE.md\` is normal: name the absence in one line and work from the brief, the task and the project's own files. Do not go looking for those rules in \`node_modules/@cc/*\` - those are the kit's own sources and its callers' implementation, not this project's documentation - and do not invent a rule to fill the gap. If the project has \`docs/GUIDE.md\` (navigation), \`docs/ARCHITECTURE.md\` (boundaries, owners, contracts, invariants) or \`docs/TERMINOLOGY.md\` (the words), read them before your first change: they are the way into a project you have not seen, and you do not create them - bootstrapping them is the orchestrator's job in a project that has none.
- **Some of the tools in your header are the HOST's, not your role's**: the MCP bridge (mcp__godot__*, mcp__playwright__*), Hindsight memory, the taskboard and the skills library are mounted at the host and inherited by every preset, so they do not widen the composition your role deliberately chose. Use them for the brief's work, and do not reach for one to do a job your role was given no tool for (a reviewer has read and bash but no write/edit).
- **No speculative tests: observe first, then persist the case.** Prove behaviour by running the product; when the behaviour is worth keeping, record it in the case library with \`case_record\` where your tool set has it, and when it does not, state the observation in your report (the steps, the expected outcome and the run you made) so the orchestrator records it; measure the red and then the green with \`case_run\` where you have it, and run \`case_gate\` where you have it, and otherwise the acceptance decision is the orchestrator's: a case is acceptance evidence for a task only when a measured run exists and neither its author nor its runner is the implementer, so a case you wrote for your own work (purpose \`implementation\`) never closes it. A behaviour that cannot be automated is recorded with its steps, expected outcome and a named reason: it keeps the requirement and is not evidence. Do not write a test to guess at behaviour.
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
/**
 * The task contract, as the child sees it (P2).
 *
 * THE SAME BLOCK FOR EVERY ROLE. The backend, the tester and the reviewer get one text: what is
 * checked, at which level, against which criteria and standing constraints. A brief that only the
 * tester received the criteria would let the implementer and the reviewer judge a different task.
 *
 * A row written before P2 has no level and no criteria: the block says so instead of inventing a
 * standard, so an old task reads exactly as before.
 */
  /**
   * One task's block in a batch-review brief (P2.1).
   *
   * The reviewer judges an OUTCOME against the task's own contract: title, objective, scope,
   * non-scope, acceptance, the result the implementer reported, its evidence, and the P2 level and
   * criteria. Rendering it from the row - not from the orchestrator's memory - is what lets one
   * reviewer cover several tasks without seeing a merged story.
   */
export function reviewTargetBlock(task) {
    const listOf = (values) => (Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value.trim() !== '') : [])
    const result = task?.result !== null && typeof task?.result === 'object' ? task.result : {}
    const criteria = Array.isArray(task?.criteria) ? task.criteria : []
    const lines = []
    lines.push(`### ${task.id}: ${task.title ?? ''}`)
    if (typeof task.objective === 'string' && task.objective !== '') lines.push(`Objective: ${task.objective}`)
    for (const [label, values] of [['Scope', listOf(task.scope)], ['Non-scope', listOf(task.nonScope)]]) {
      if (values.length > 0) lines.push(`${label}:\n${values.map((value) => `  - ${value}`).join('\n')}`)
    }
    const acceptance = (Array.isArray(task.acceptance) ? task.acceptance : []).map((entry) => (typeof entry === 'string' ? entry : entry?.text)).filter((value) => typeof value === 'string' && value !== '')
    if (acceptance.length > 0) lines.push(`Acceptance:\n${acceptance.map((value) => `  - ${value}`).join('\n')}`)
    if (typeof task.verification === 'string' && task.verification !== '') lines.push(`Verification level: ${task.verification}`)
    if (criteria.length > 0) lines.push(`Criteria:\n${criteria.map((entry) => `  - ${entry.id}: ${entry.text ?? ''}`).join('\n')}`)
    if (typeof result.summary === 'string' && result.summary !== '') lines.push(`Result (the implementer's claim): ${result.summary}`)
    const evidence = listOf(result.evidence)
    if (evidence.length > 0) lines.push(`Evidence (the implementer's):\n${evidence.map((value) => `  - ${value}`).join('\n')}`)
    return lines.join('\n')
  }


export function contractBlock(task) {
  const level = typeof task?.verification === 'string' ? task.verification : ''
  const criteria = Array.isArray(task?.criteria) ? task.criteria.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.id === 'string') : []
  const constraints = Array.isArray(task?.constraints) ? task.constraints.filter((entry) => typeof entry === 'string' && entry.trim() !== '') : []
  if (level === '' && criteria.length === 0 && constraints.length === 0) return ''
  const standing = {
    proof: 'This task is accepted on the owner\'s own proof: run the product and quote the command, the output and the exit code. No case, no tester and no review are owed unless a risk trigger appears.',
    case: 'This task is accepted on proof plus one case when the behaviour is worth pinning. Independence is not required; a case that exists must still be measured.',
    independent: 'This task is accepted only when ANOTHER preset wrote and ran the acceptance case against a wrong-product red, and every criterion below is covered by an acceptable case that names it.',
  }
  const lines = []
  lines.push(`\n## Task contract`)
  lines.push(`- Verification level: ${level === '' ? '(not stated; the row predates P2)' : level}`)
  if (level !== '') lines.push(`- What that means: ${standing[level] ?? standing.proof}`)
  lines.push(criteria.length === 0 ? '- Acceptance criteria: (none stated)' : `- Acceptance criteria:\n${criteria.map((entry) => `  - ${entry.id}: ${typeof entry.text === 'string' ? entry.text : ''}`).join('\n')}`)
  if (constraints.length > 0) lines.push(`- Constraints:\n${constraints.map((entry) => `  - ${entry}`).join('\n')}`)
  lines.push(level === 'independent' ? '- Do not sign off your own implementation: a defect goes back to the implementer and the tester reruns.' : '- Report the product run you performed; the orchestrator decides acceptance.')
  return `${lines.join('\n')}\n`
}

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
${contractBlock(task)}
${typeof extra.carryForward === 'string' && extra.carryForward.trim() !== '' ? `\n${extra.carryForward}\n` : ''}
## Required output

1. Summary — at most ten lines, the outcome first.
2. Evidence — the commands you ran, their output and exit codes, and the files you changed. A claim without evidence is not a result.
3. What you skipped or could not verify.
4. Risks or decisions the orchestrator must know.

## Rules

- Read the callers before you edit; take the smallest complete change; do not add a dependency for a few lines.
- Name things in the project's words (\`docs/TERMINOLOGY.md\` when present); never invent a term, and cite an identifier as evidence after the plain statement.
- Do not guess with tests: observe first, then persist the case. Run the product and quote what it produced; when the brief asks for a case, record it with \`case_record\` (red-first evidence for automated). A test file only for an observed case, and name the production behaviour it protects.
- Do not expand scope. If the brief is wrong, say so and stop.
- Use \`task_note\` for significant findings and \`task_get\` to re-read the task. The orchestrator owns acceptance.

${input.timebox === undefined ? '' : `Timebox: ${input.timebox}\n`}`
  if (brief.length <= limit) return brief
  return `${brief.slice(0, limit - 160)}\n\n[Brief truncated at ${limit} characters. The task fields remain authoritative; ask the orchestrator for the missing part.]`
}

/**
 * The PATH a scope entry claims, normalized; '' when the entry is prose rather than a claim.
 *
 * WHY A TOKEN AND NOT THE WHOLE STRING. `scope` is written for a human - "plugins/orchestrator:
 * PRESET_IDS and ROLE_PRESETS gain devops" - so the claim is the leading path: a token with a
 * slash or a dot, a directory written with its trailing slash, the prose after it ignored. An
 * entry with neither a slash nor a dot ("read the product modules") claims nothing, so a brief
 * written in sentences cannot collide by accident. `..` is resolved lexically and a leading
 * `./` is dropped, so two spellings of one file compare equal.
 *
 * @param entry - One `scope` string.
 * @param cwd - The task's working directory, used to relativize an absolute path under it.
 * @returns The normalized relative path, or '' when the entry claims no path.
 */
export function scopeClaim(entry, cwd = '') {
  if (typeof entry !== 'string') return ''
  // POSIX separators only: the kit's scopes are written with '/', and the portability
  // check forbids treating a backslash as a separator (it is a no-op on Linux and hides the
  // assumption). An entry written with backslashes does not parse, so it claims nothing.
  let text = entry.trim()
  if (text === '') return ''
  const root = typeof cwd === 'string' ? cwd.replace(/\/+$/, '') : ''
  if (text.startsWith('/')) {
    if (root !== '' && text.startsWith(root + '/')) text = text.slice(root.length + 1)
    else return ''
  }
  const token = /^[A-Za-z0-9_.@+~-][A-Za-z0-9_.@+~/-]*\/?/.exec(text)
  if (token === null) return ''
  let value = token[0]
  if (!value.includes('/') && !value.includes('.')) return ''
  value = value.replace(/^\.\//, '').replace(/\/+$/, '')
  const parts = []
  for (const part of value.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') { parts.pop(); continue }
    parts.push(part)
  }
  return parts.join('/')
}

/** Whether two normalized claims name one file: equal, or one is a directory containing the other. */
export function claimsOverlap(left, right) {
  if (left === '' || right === '') return false
  return left === right || left.startsWith(right + '/') || right.startsWith(left + '/')
}

/**
 * The first collision between a task's scope and the scopes already claimed by active tasks.
 *
 * WHY ONLY `active`. A row in `open` is a plan nobody is executing yet, and a batch is created
 * as several open rows for one seat; a row in `review` is finished work waiting for acceptance.
 * Only an active row is work in flight, and only work in flight can collide with another child.
 *
 * @param scope - The scope list this task would claim.
 * @param holders - Active tasks, each `{ id, role, title, scope }`.
 * @param cwd - The task's working directory.
 * @returns `{ path, claim, task }` or undefined.
 */
export function scopeConflict(scope, holders, cwd = '') {
  const mine = (Array.isArray(scope) ? scope : []).map((entry) => scopeClaim(entry, cwd)).filter((value) => value !== '')
  if (mine.length === 0) return undefined
  for (const holder of Array.isArray(holders) ? holders : []) {
    const theirs = (Array.isArray(holder?.scope) ? holder.scope : []).map((entry) => scopeClaim(entry, cwd)).filter((value) => value !== '')
    for (const path of mine) {
      for (const claim of theirs) {
        if (claimsOverlap(path, claim)) return { path, claim, task: holder }
      }
    }
  }
  return undefined
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
  if (knownAgent === undefined) return false
  if (typeof knownAgent.sessionId !== 'string' || knownAgent.sessionId === '') return false
  if (knownAgent.preset !== preset) return false
  // A ROLE'S SESSION IS A SOCKET, NOT A QUEUE. While it is still running a task, a second
  // brief delivered to it is executed INSIDE the first task's turn: measured 2026-11-12, a
  // ledger brief landed in the child working the stored band, and neither the timeline nor
  // the interrupt could tell the two apart afterwards. A busy socket is not reused; the
  // caller starts a fresh session and the role row keeps the old id in its history.
  const busy = knownAgent.status === 'active'
    && typeof knownAgent.currentTaskId === 'string'
    && knownAgent.currentTaskId !== ''
  return !busy
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
  const busy = knownAgent.status === 'active'
    && typeof knownAgent.currentTaskId === 'string'
    && knownAgent.currentTaskId !== ''
  if (busy) return `the existing ${role} session is still running task ${knownAgent.currentTaskId}; a fresh session was started instead of queueing a second brief into it`
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
    description: `Create one task (or attach taskId), render a self-contained brief, start a child on the role preset and link its session. Roles: UX/UI, BACKEND, DEVOPS, RESEARCH, CONTEXT, REVIEWER, CRITIC, DOCS; another role needs an explicit preset. DEVOPS owns the running deployment and runs one live deployment task per chat: a second is refused with devops_lane_busy. While this chat's board holds more than \${BOARD_WIP_LIMIT} unclosed tasks a NEW task is refused with board_limit and only TESTER and CRITIC may be delegated; the refusal names the unclosed total, how many rows wait for acceptance and the verification debt behind the limit. Attaching to an already open task with taskId stays allowed. A near-duplicate new role is refused unless forceRole. Pass provider/model only when the default route cannot do the work.`,
    parameters: {
      title: { type: 'string', required: true, description: 'Short task title.' },
      role: { type: 'string', required: true, description: 'Specialist role, e.g. UX/UI, BACKEND, DEVOPS, RESEARCH, CONTEXT, REVIEWER, CRITIC, DOCS. The roles this workspace already has are listed in your policy section - reuse one of those exact names; all fitting tasks belong to it.' },
      preset: { type: 'string', enum: PRESET_IDS, description: 'Tool composition for the child. Omit to derive it from the role; pass it explicitly when the role is a specialty outside the eleven (e.g. a migration under preset backend, or an adversarial pass over an algorithm with preset critic). PRESENTER is a role name too: use it for a deck, a board or an animated explanation instead of DUMMY. AUDIT is not accepted as a name at all - use REVIEWER or CRITIC.' },
      roleDescription: { type: 'string', description: 'Optional one-line responsibility zone for a newly created specialist.' },
      objective: { type: 'string', required: true, description: 'The outcome in one paragraph, not the activity.' },
      scope: { type: 'array', items: { type: 'string' }, description: 'What the child may touch. Entries are claimed as paths (a file with its extension, a directory with its trailing slash; prose after the path is ignored), and delegate_task refuses a scope that collides with an active task\'s file.' },
      nonScope: { type: 'array', items: { type: 'string' }, description: 'What the child must not touch, with the reason.' },
      acceptance: { type: 'array', items: { type: 'string' }, description: 'How you will judge the result.' },
      verification: { type: 'string', enum: ['proof', 'case', 'independent'], description: 'P2 verification level for the task the child owns. proof: the child runs the product and quotes it (L0). case: proof plus one case when the behaviour is worth pinning (L1). independent: another preset writes and runs the acceptance case against a wrong-product red, and every criterion must be covered (L2, or a risk trigger: contract, data, architecture, security, money, migration, concurrency). Default proof: the standard is proportional, not a full cycle for every task.' },
      criteria: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', description: 'Stable id, for example AC-1.' }, text: { type: 'string', description: 'One checkable sentence.' } }, additionalProperties: false, description: 'Acceptance criteria with stable ids. A bare string gets AC-n. Required for level independent: without criteria there is nothing for a case to cover.' } },
      constraints: { type: 'array', items: { type: 'string' }, description: 'Standing rules the work must obey (no new dependency, no schema change, keep the public CLI). Rendered into the child brief with the rest of the contract.' },
      inputs: { type: 'array', items: { type: 'string' }, description: 'Files, decisions and links the child needs.' },
      timebox: { type: 'string', description: 'Optional timebox or stopping condition.' },
      parentTaskId: { type: 'string', description: 'Optional parent task id.' },
      taskId: { type: 'string', description: 'Attach this delegation to an existing task instead of creating a second one. The task must not be done, cancelled or paused, and its role must match.' },
      reqIds: { type: 'array', items: { type: 'string' }, description: 'The requirements this task implements (REQ-001). Required when delegate_task CREATES the task, unless chore is true with a choreReason; an attach with taskId carries its own basis.' },
      reqId: { type: 'string', description: 'One requirement id for a single-requirement task; merged with reqIds.' },
      chore: { type: 'boolean', description: 'true when the work is justified housekeeping rather than a requirement; needs a non-empty choreReason. A standalone review that implements no requirement is a chore with the reason stated.' },
      choreReason: { type: 'string', description: 'Why this chore is needed; required with chore:true.' },
      legacyAttach: { type: 'boolean', description: 'Explicitly continue a task that predates the analysis contour without an Analysis Record. Only valid with taskId and with no changeClass/analysisId/requirementIds/architectureImpact. A fresh task attach without this flag is refused analysis_required.' },
      forceRole: { type: 'boolean', description: 'Allow a role name that resembles an existing one. Use only for a genuinely different specialty; naming the work with the existing role is almost always right.' },
      cwd: { type: 'string', description: 'Optional working directory; inherits the parent cwd.' },
      priority: { type: 'string', enum: ['low', 'normal', 'high'], description: 'Task priority.' },
      changeClass: { type: 'string', enum: ['L0', 'L1', 'L2'], description: 'Proportional analysis gate. L0 = a question or a local fix with no contract/architecture change and no Analysis Record; L1 = a contained feature inside the existing components; L2 = a cross-component, contract or data change. L1/L2 need analysisId + requirementIds and a ready record; L0 passes without one. When the analysis service is not mounted this is ignored (legacy behaviour).' },
      analysisId: { type: 'string', description: 'The Analysis Record initiative id in docs/analysis/<initiative>.json. Required for L1/L2; the gate refuses analysis_required when it is missing or not ready, and analysis_stale when an affected requirement or the design map moved.' },
      requirementIds: { type: 'array', items: { type: 'string' }, description: 'The requirement ids this delegation implements, from the Analysis Record. The task is traced onto each one before the child starts.' },
      architectureImpact: { type: 'boolean', description: 'True when this delegation changes architecture, data or a contract. The gate then also refuses analysis_stale when the design map moved past designRef.mapRev.' },
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
      // outside the nine.
      // AUDIT IS REFUSED AS A NAME, not merely unmapped. Unmapped alone would still let
      // `role: "AUDIT", preset: "reviewer"` through, which is exactly the ambiguity: one label
      // whose tool set depends on the call. The board keeps the rows it already has as
      // history; new work must name the job.
      if (normalizeRole(role) === 'audit') {
        throw new Error(`delegate_task: "AUDIT" is two jobs, not one role. Use REVIEWER to judge a change (preset reviewer) or CRITIC to attack a running behaviour (preset critic); each keeps its own tool set, and an AUDIT name already on the board stays there as history.`)
      }
      const preset = typeof args.preset === 'string' && args.preset !== '' ? args.preset : presetForRole(role)
      if (preset === undefined) {
        throw new Error(`delegate_task: role "${role}" names none of the eleven tool compositions (${PRESET_IDS.join(', ')}). Reuse one of those role names (CRITIC/QA/TESTER map to the adversarial tester, CONTEXT/GATHERER to reconnaissance), or pass preset explicitly when the role is a genuine specialty.`)
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
      // A ROLE BELONGS TO A CHAT, NOT TO THE WORKSPACE.
      // A specialist session is a direct child of the chat that started it: the subagent
      // runtime refuses delivery from any other chat, and the ledger row records its owner in
      // `chatSessionId`. So the role this call may continue is THIS chat's row only. Measured
      // 2026-11-13: a new chat resolved the workspace-global row, treated another chat's
      // sleeping child as a reuse candidate, called `sendMessage` on it, and reported the
      // runtime's refusal as if the role had died - while the same global row also refused a
      // different preset and a similar name that belonged to somebody else's history.
      // Everything below (reuse, preset conflict, legacy refusal, similar-name check) reads
      // this chat's rows; the workspace history stays readable for the human and for
      // carry-forward, which is the one place it is wanted.
      const chatId = parent.id
      // WORK IN FLIGHT HAS A CEILING. A new executor on an already-overfull board does not
      // shorten the queue, it lengthens it; only the checkers can close work someone else
      // built. The count is this chat's board, read through the SAME taskboard.list({ chatId })
      // the devops lane below uses, and done/cancelled rows are not work in flight. An attach
      // (taskId) adds no unclosed work, so it is not refused: the ceiling is on NEW work.
      const attachTaskId = typeof args.taskId === 'string' && args.taskId !== '' ? args.taskId : ''
      if (preset !== 'tester' && preset !== 'critic' && attachTaskId === '') {
        let unclosed = []
        try {
          unclosed = taskboard.list(taskCwd, { chatId }).filter((task) => task !== null && typeof task === 'object'
            && !['done', 'cancelled'].includes(task.status))
        } catch {
          unclosed = []
        }
        const awaitingAcceptance = unclosed.filter((task) => task.status === 'review').length
        if (unclosed.length > BOARD_WIP_LIMIT) {
          throw new Error(`delegate_task: board_limit - this chat's board holds ${unclosed.length} unclosed tasks, more than the limit of ${BOARD_WIP_LIMIT}, and ${awaitingAcceptance} of them are waiting for acceptance (status review). The limit is about verification debt, not throughput: each change must be proved working before the next one starts (minimal viable change), so more than ${BOARD_WIP_LIMIT} unclosed tasks is work piling up unproven, not progress. While the board is over the limit a NEW task is refused: only the checkers may be delegated a new task (TESTER, CRITIC), and attaching to an already open task with taskId is allowed. Finish, prove or close open work with task_close or task_cancel before delegating a new ${role}.`)
        }
      }
      // DEVOPS OWNS THE RUNTIME LANE, AND ONE LANE HOLDS ONE LIVE TASK. The runtime is a
      // shared resource, not a tool: a second deployment restarts or replaces what the
      // open task is still measuring, and the restart ends that task's running child.
      // The refusal keys on the LEDGER's own status of a task whose preset is devops,
      // never on the brief's wording: a word list cannot tell 'restart the stand' from
      // 'read the restart section of the docs', and a wrong refusal is worse than none.
      // Attaching to the open task is how a follow-up brief reaches the same seat, so the
      // attach id is excluded; a task in review is settled work awaiting acceptance and
      // does not hold the lane.
      if (preset === 'devops') {
        const attachId = typeof args.taskId === 'string' && args.taskId !== '' ? args.taskId : ''
        const live = (() => {
          try {
            return taskboard.list(taskCwd, { chatId }).filter((task) => task !== null && typeof task === 'object'
              && task.preset === 'devops'
              && task.id !== attachId
              && ['open', 'active', 'blocked', 'paused'].includes(task.status))
          } catch {
            return []
          }
        })()
        if (live.length > 0) {
          const named = live.slice(0, 3).map((task) => String(task.id) + ' (' + String(task.status) + ', ' + String(task.role ?? 'DEVOPS') + '): ' + String(task.title ?? 'untitled')).join('; ')
          throw new Error('delegate_task: devops_lane_busy - the runtime lane runs ONE live deployment task per chat, and the board still holds ' + (live.length === 1 ? 'one' : String(live.length)) + ': ' + named + '. A second deployment would restart or replace the runtime the open task is measuring and end its running child. Attach to it with taskId, or accept and close it with task_close, before delegating the next deployment. Delegations to other roles are unaffected.')
        }
      }
      // SCOPE IS THE CLAIM, AND TWO LIVE TASKS CANNOT CLAIM ONE FILE. The scope list is not
      // only a brief field: it is the file or directory the child is about to touch. A second
      // child whose scope names the same file (or a directory that contains it) is refused
      // BEFORE its row or its child exists, so the collision cannot be discovered by the two
      // children overwriting each other. Only an active task holds a claim: open rows are plans,
      // review rows are settled work, and a batch creates several open rows for one seat.
      const activeScopeHolders = () => {
        let rows = []
        try {
          rows = taskboard.list(taskCwd, { chatId })
        } catch {
          rows = []
        }
        const holders = []
        for (const row of Array.isArray(rows) ? rows : []) {
          if (row === null || typeof row !== 'object' || row.status !== 'active') continue
          let full
          try {
            full = taskboard.get(taskCwd, row.id)
          } catch {
            full = undefined
          }
          const scope = Array.isArray(full?.scope) ? full.scope : []
          if (scope.length === 0) continue
          holders.push({ id: row.id, role: row.role ?? '', title: full?.title ?? row.title ?? '', scope })
        }
        return holders
      }
      const refuseScopeCollision = (scope, selfId) => {
        const holders = activeScopeHolders().filter((holder) => holder.id !== selfId)
        const clash = scopeConflict(scope, holders, taskCwd)
        if (clash === undefined) return
        throw new Error(`delegate_task: scope_overlap - task "${clash.task.id}" (${clash.task.role || 'role unknown'}) is active and already claims "${clash.claim}"; this task's scope claims "${clash.path}", and two subagents cannot work on one file. Narrow this task's scope, close "${clash.task.id}" first, or attach to it with taskId.`)
      }
      // A fresh chat does not know the ledger, so the model invents AUDIT where BACKEND
      // already exists. Refusing before a task exists is a correction; the catalog in the
      // policy section is the choice it should have seen. forceRole is the escape hatch.
      const knownAgent = (() => {
        try {
          return taskboard.findAgent(taskCwd, role, chatId)
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
        throw new Error(`delegate_task: role "${knownAgent.role}" is a legacy row from before role presets - its child's tool set is unknown, so it cannot be reused. Name this work with one of the eleven roles (${PRESET_IDS.join(', ')}), or pass forceRole: true with an explicit preset to re-compose it deliberately.`)
      }
      if (knownAgent !== undefined && knownPreset !== '' && knownPreset !== preset && args.forceRole !== true) {
        throw new Error(`delegate_task: role "${knownAgent.role}" is already the [${knownPreset}] role in this workspace, and a role label keeps one tool set. ${knownPreset === 'reviewer' || preset === 'reviewer' ? 'REVIEWER judges a change while CRITIC attacks a running behaviour - use the role that owns this work. ' : ''}Pass forceRole: true only to deliberately re-compose the role.`)
      }
      if (knownAgent === undefined && args.forceRole !== true) {
        let agents = []
        try {
          // This chat's names only: a role another chat already uses is not a reason to refuse
          // the name here - its specialist is unreachable from this chat, so the name is
          // reused for a NEW child, and only a name this chat itself uses is "written
          // differently".
          agents = taskboard.agents(taskCwd, chatId)
        } catch {
          agents = []
        }
        const similar = agents.filter((agent) => roleMatches(agent.role, role))
        if (similar.length > 0) {
          const names = similar.map((agent) => `"${agent.role}"`).join(', ')
          throw new Error(`delegate_task: "${role}" is ${names} written differently. Reuse that exact role name; pass forceRole: true only if this is a genuinely different specialty.`)
        }
      }

      // A legacy attach is an EXPLICIT declaration for a task that predates the analysis
      // contour. It is never inferred from omitted arguments or from a timestamp; the root
      // must say legacyAttach: true on the attach call.
      const attachId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
      const explicitAttach = args.changeClass !== undefined
        || args.analysisId !== undefined
        || args.requirementIds !== undefined
        || args.architectureImpact === true
      const legacyAttach = attachId !== '' && args.legacyAttach === true && !explicitAttach

      // ANALYSIS BEFORE DECOMPOSITION, AND ONLY WHEN THE SERVICE IS MOUNTED.
      // The analysis row is deliberately NOT in `inject`: a composition without it must keep
      // the legacy delegation behaviour, so the gate is looked up here and skipped when absent.
      // A refusal happens BEFORE any taskboard write: "no task row and no child" is the only
      // answer that cannot leave work in flight. L0 is answered by the gate without reading a
      // record, which is what keeps a local fix proportional.
      let analysisGate
      let analysisService
      try {
        analysisService = ctx.get('analysis')
      } catch {
        analysisService = undefined
      }
      if (analysisService !== undefined && typeof analysisService.gate === 'function') {
        const gated = analysisService.gate(taskCwd, {
          initiative: typeof args.analysisId === 'string' ? args.analysisId.trim() : '',
          requirementIds: Array.isArray(args.requirementIds) ? args.requirementIds : [],
          architectureImpact: args.architectureImpact === true,
          changeClass: typeof args.changeClass === 'string' ? args.changeClass : undefined,
          role,
          preset,
          legacyAttach,
        })
        if (gated?.ok !== true) {
          return {
            ok: false,
            code: typeof gated?.code === 'string' && gated.code !== '' ? gated.code : 'analysis_required',
            message: typeof gated?.message === 'string' && gated.message !== ''
              ? gated.message
              : 'delegate_task: the analysis gate refused this delegation; no task was created and no child was started.',
            ...(Array.isArray(gated?.findings) && gated.findings.length > 0 ? { findings: gated.findings } : {}),
            ...(gated?.rev === undefined ? {} : { analysisRev: gated.rev }),
          }
        }
        analysisGate = gated
      }

      // One piece of work is one row. The root usually creates the task first and then
      // delegates it; attaching keeps that pair from becoming two near-duplicate tasks.
      // Tasks belong to a chat now, so a task id from somebody else's board is refused
      // here, before a child is started against work this chat cannot see.
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
        refuseScopeCollision(existing.scope, existing.id)
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
          // THE BOARD'S OWN REASON IS THE ANSWER. A refusal that names no row - dependency_open
          // names the task the new one waits for - is handed to the root as the board wrote it,
          // so the next step (wait for that task, or close it) is visible without a second read.
          const reason = typeof updated?.message === 'string' && updated.message !== '' ? ` ${updated.message}` : ''
          noteRefusal(taskboard, taskCwd, existing.id, code)
          return { ok: false, code, message: `delegate_task: the taskboard refused to attach task "${attachId}" (${code}); no child was started. The task was left untouched or blocked with that code.${reason}` }
        }
        task = updated.task
      } else {
        refuseScopeCollision(args.scope, '')
        task = taskboard.create(taskCwd, {
          title: args.title,
          role,
          preset,
          objective: args.objective,
          scope: args.scope,
          nonScope: args.nonScope,
          acceptance: args.acceptance,
          // P2: the contract the task is accepted against travels WITH the row, so the brief and
          // the close read the same fields.
          ...(typeof args.verification === 'string' && args.verification !== '' ? { verification: args.verification } : {}),
          ...(Array.isArray(args.criteria) ? { criteria: args.criteria } : {}),
          ...(Array.isArray(args.constraints) ? { constraints: args.constraints } : {}),
          parentId: args.parentTaskId,
          parentSessionId: parent.id,
          chatId,
          priority: args.priority,
          // THE BASIS OF THE TASK. The board refuses a row that implements no requirement and
          // is not a justified chore (`req_required`), and delegate_task used to pass neither
          // a requirement nor a chore reason: a review of existing code could not be
          // delegated at all, and the refusal read like a full board. The rule stays the
          // board's; this call now carries what the root stated.
          reqIds: Array.isArray(args.reqIds) ? args.reqIds : [],
          reqId: typeof args.reqId === 'string' ? args.reqId : '',
          chore: args.chore === true,
          choreReason: typeof args.choreReason === 'string' ? args.choreReason : '',
          // The task is created before the child exists: it is open, not active. linkChild
          // moves it when the child is really running.
          status: 'open',
        }, 'orchestrator')
        // A REFUSED CREATE HAS NO ROW. `board_full` (the cap) used to fall through to a
        // brief and a child for a task that does not exist - the whole delegation ran
        // against `undefined`. The refusal is the result; nothing is spawned.
        if (task?.ok === false || typeof task?.id !== 'string') {
          const code = typeof task?.code === 'string' && task.code !== '' ? task.code : 'taskboard_refused'
          // THE BOARD'S OWN REASON IS THE ANSWER. This sentence used to blame the row cap for
          // every refusal, so a `req_required` refusal sent the root hunting for a row to
          // free while the board was not full. The board's message names the missing basis;
          // only the cap adds the advice about freeing a row.
          const reason = typeof task?.message === 'string' && task.message !== '' ? ` ${task.message}` : ''
          const advice = code === 'board_full'
            ? ' Free a row (task_close / task_cancel) or delegate onto an existing task with taskId.'
            : ''
          return { ok: false, code, message: `delegate_task: the taskboard refused to create the task (${code}); no child was started.${reason}${advice}` }
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

      // THE TASK IS TRACED BEFORE THE CHILD EXISTS. The Analysis Record is the only trace
      // store (the taskboard stays a lifecycle ledger), so the delegating path writes the
      // task id onto each named requirement. A refused trace blocks the task and returns;
      // a child must never work for a requirement the record does not know about.
      let analysisLink
      if (analysisGate?.analysisRequired === true) {
        const requirementIds = (analysisGate.requirements ?? []).map((requirement) => requirement.id)
        const linked = analysisService.linkTask(taskCwd, {
          initiative: analysisGate.initiative,
          requirementIds,
          taskId: task.id,
          role,
          expectedRev: analysisGate.rev,
        })
        if (linked?.ok !== true) {
          const code = typeof linked?.code === 'string' && linked.code !== '' ? linked.code : 'analysis_conflict'
          try {
            const current = taskboard.get(taskCwd, task.id)
            taskboard.update(taskCwd, {
              id: task.id,
              expectedRevision: current?.revision ?? task.revision,
              chatId,
              patch: { status: 'blocked', reason: `analysis trace refused: ${code}`, result: { risks: [`analysis trace refused: ${code}`] } },
            })
          } catch {
            // The task update is best-effort; the refusal below is the answer.
          }
          return {
            ok: false,
            code,
            message: `delegate_task: the Analysis Record "${analysisGate.initiative}" refused the task trace (${code}); no child was started. Update the trace with analysis_upsert and try again.`,
          }
        }
        analysisLink = linked
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
          // THE FACTS OF THE DELEGATION, NOT THE SPEC SHAPE: harness-seam.mjs builds the
          // activation object both pinned harness contracts read (see that module).
          const activation = await ctx.subagents.startActivation(activationSpec({
            role,
            preset,
            prompt: `${roleBrief}\n\n${childBrief}`,
            parent,
            route: provider,
            signal: exec.signal,
            ...(childCwd === taskCwd ? {} : { cwd: childCwd }),
            ...(agentOptions === undefined ? {} : { agentOptions }),
          }))
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
          const reason = typeof linked?.message === 'string' && linked.message !== '' ? ` ${linked.message}` : ''
          noteRefusal(taskboard, taskCwd, task.id, code)
          return { ok: false, code, message: `delegate_task: the taskboard refused to link child "${childId}" to task "${task.id}" (${code}); the child was interrupted and no work was started.${reason}` }
        }
        return {
          taskId: task.id,
          childId,
          role,
          preset,
          reused,
          title: task.title,
          status: 'active',
          ...(analysisGate?.analysisRequired === true
            ? {
                analysisId: analysisGate.initiative,
                requirementIds: (analysisGate.requirements ?? []).map((requirement) => requirement.id),
                analysisClass: analysisGate.class,
                ...(analysisLink?.rev === undefined ? {} : { analysisRev: analysisLink.rev }),
              }
            : {}),
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

  /**
   * The preset a session actually runs.
   *
   * The policy owner answers first: `toolFamilies` resolves a selection made after creation,
   * including one committed while the session was still blank, which is exactly the case a
   * registration-time read gets wrong. Without that row the harness's projection is the next
   * authority, and the creation header is only the last fallback.
   */
  const presetOf = (agent) => {
    try {
      const fromPolicy = ctx.get?.('toolFamilies')?.presetFor?.(agent?.session)
      if (typeof fromPolicy === 'string' && fromPolicy.trim() !== '') return fromPolicy
    } catch {
      // A composition without the policy owner falls through to the projection.
    }
    try {
      const fromProjection = ctx.get?.('agentPresets')?.presetForSession?.(agent?.session)
      if (typeof fromProjection === 'string' && fromProjection.trim() !== '') return fromProjection
    } catch {
      // A bare headless assembly has no projection.
    }
    const fromHeader = agent?.session?.header?.agentPreset
    return typeof fromHeader === 'string' && fromHeader.trim() !== '' ? fromHeader : undefined
  }

  /**
   * The one sentence about the tool set this session really has.
   *
   * WHY IT IS DERIVED. The policy used to deny every shell tool in a literal sentence, and a
   * root whose preset this policy does not describe read the same sentence about a session
   * that DID carry `bash` (109 tools, measured 2026-11-17). The facts belong to the policy
   * owner (`toolFamilies.factsFor`): `removed` is measured against the host tool list when the
   * restriction is installed, so a pattern that matched nothing is never quoted and this
   * plugin does not read the tool registry a second time. Without the service it asserts
   * nothing.
   *
   * @returns A short markdown block, or '' when there is nothing true to say.
   */
  const toolSetClaim = (agent) => {
    let facts
    try {
      facts = ctx.get?.('toolFamilies')?.factsFor?.(agent)
    } catch {
      return ''
    }
    if (facts === null || facts === undefined) return ''
    // The facts are about the preset the policy was APPLIED with. A switch that has not been
    // recomputed yet would make this a claim about another role.
    if (facts.preset !== POLICY_PRESET) return ''
    const removed = (Array.isArray(facts.removed) ? facts.removed : []).filter((pattern) => typeof pattern === 'string' && pattern.trim() !== '')
    if (removed.length === 0) return ''
    return [
      '## Your tool set (deployment)',
      '',
      `The deployment's family policy removed ${removed.map((pattern) => `\`${pattern}\``).join(', ')} from this session's tool set before its first request, so it is not in the request header. This line is fixed for the session: if a task needs one of those families, delegate it to the role that owns it.`,
    ].join('\n')
  }

  /**
   * Freeze the policy facts per agent for the life of the session.
   *
   * The catalog and the board debt are re-read every turn on purpose; the tool-set claim is
   * not, because the tools a session was given do not change and a prompt whose prefix
   * changes is re-billed from the first changed byte. The memo also covers the preset gate:
   * a session switched to another preset after its first prompt keeps the text it started
   * with, which is the invariant the prompt owns (`INV-PROMPT-FROZEN`).
   */
  const policySessions = new WeakMap()
  const policyFor = (agent) => {
    const memo = policySessions.get(agent)
    if (memo !== undefined) return memo
    const preset = presetOf(agent)
    const described = preset === POLICY_PRESET
    const record = { preset, described, claim: described ? toolSetClaim(agent) : '' }
    policySessions.set(agent, record)
    return record
  }


  // The per-task block is module-level so a test can read exactly what the brief carries.
  const blockOf = reviewTargetBlock

  const reviewTool = defineTool({
    name: 'delegate_review',
    description: 'Review SEVERAL tasks with ONE reviewer. Pass 2-8 task ids of tasks waiting in review; this creates ONE review task, starts ONE REVIEWER child and renders every reviewed task (title, objective, scope, non-scope, acceptance, verification level, criteria, the result and the evidence the implementer reported) into its brief. The child answers with a verdict per task - pass or fail, findings and evidence - and closes NONE of them: the reviewed tasks stay in review and you close each one yourself with task_close when its verdict and your own reading agree, so a failed task goes back to active while its neighbours are unaffected. Use delegate_task with REVIEWER for a single task. This is not a merge of TESTER and REVIEWER: the acceptance case still belongs to the tester, and the reviewer judges the change.',
    parameters: {
      taskIds: { type: 'array', items: { type: 'string' }, required: true, description: 'The 2-8 task ids one reviewer covers. Every task must exist and be in review.' },
      focus: { type: 'string', description: 'Optional shared focus for the batch (for example "the CLI contract only"); per-task scope stays its own.' },
      title: { type: 'string', description: 'Optional title for the review task.' },
      timebox: { type: 'string', description: 'Optional timebox or stopping condition for the reviewer.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const raw = Array.isArray(args?.taskIds) ? args.taskIds : []
      const ids = [...new Set(raw.filter((entry) => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim()))]
      if (ids.length < 2 || ids.length > 8) throw new Error(`delegate_review: pass 2-8 task ids, got ${ids.length}. One task is a normal review - use delegate_task with REVIEWER`)
      let taskboard
      try { taskboard = ctx.get('taskboard') } catch { taskboard = undefined }
      if (taskboard === undefined || taskboard === null) throw new Error('delegate_review: the taskboard service is not mounted, so the reviewed tasks cannot be read')
      const cwd = workingDir(exec.agent)
      const tasks = ids.map((id) => taskboard.get(cwd, id))
      const missing = ids.filter((id, index) => tasks[index] === undefined)
      if (missing.length > 0) throw new Error(`delegate_review: no such task: ${missing.join(', ')}`)
      const notInReview = tasks.filter((task) => task.status !== 'review').map((task) => `${task.id} (${task.status})`)
      if (notInReview.length > 0) throw new Error(`delegate_review: a batch review judges tasks that are in review; not ready: ${notInReview.join(', ')}`)
      const already = []
      for (const task of (taskboard.list(cwd, { all: true }) ?? [])) {
        if (task?.status === 'done' || task?.status === 'cancelled') continue
        if (Array.isArray(task?.reviewedTaskIds) && task.reviewedTaskIds.some((id) => ids.includes(id))) already.push(task.id)
      }
      if (already.length > 0) throw new Error(`delegate_review: these tasks are already covered by an open batch review: ${already.join(', ')}`)
      const blocks = tasks.map(blockOf)
      const focus = typeof args?.focus === 'string' && args.focus.trim() !== '' ? args.focus.trim() : ''
      const result = await definition.execute({
        title: typeof args?.title === 'string' && args.title.trim() !== '' ? args.title.trim() : `Batch review: ${ids.length} tasks`,
        role: 'REVIEWER',
        objective: `Judge ${ids.length} tasks against their own contracts in one pass: ${ids.join(', ')}. Report a verdict per task and close none of them.`,
        scope: blocks,
        nonScope: ['Do not close any reviewed task: the orchestrator closes each one itself', 'Do not edit product code', 'Do not author or edit acceptance cases: the tester owns them'],
        acceptance: [
          `One entry per reviewed task in \`results\`: {taskId, verdict: "pass" | "fail", findings: [...], evidence: [...]}`,
          'A fail names the defect and the command or file that shows it; a pass names what you ran',
          'No reviewed task is closed from this session',
        ],
        inputs: [`Focus for the batch: ${focus === '' ? '(each task\'s own contract)' : focus}`],
        chore: true,
        choreReason: `batch review of ${ids.length} tasks by one reviewer`,
        ...(typeof args?.timebox === 'string' && args.timebox !== '' ? { timebox: args.timebox } : {}),
      }, exec)
      if (result === undefined || result === null || result.ok === false) return result
      const reviewTaskId = result.task?.id ?? result.id
      if (typeof reviewTaskId !== 'string' || reviewTaskId === '') return result
      const patched = taskboard.update(cwd, { id: reviewTaskId, patch: { reviewedTaskIds: ids } })
      return { ...result, reviewedTaskIds: ids, ...(patched?.ok === true ? { reviewTask: patched.task } : {}) }
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
        // The role catalog is another chat's roster until this chat splits it: the names are
        // the workspace's, but only this chat's rows are sessions the policy may promise to
        // continue. renderRoleCatalog does that split from the chatId.
        const chatId = agent?.session?.header?.id ?? agent?.id ?? ''
        // NFR1: the system message is an INVARIANT of the session. The role catalog is a
        // static configuration of the deployment (the nine roles below), and the board debt
        // travels through state-feed (L1 digest/snapshot, L2 delta) instead of being rerendered
        // into the prompt on every turn. Only the preset claim may vary, and it is fixed per
        // session.
        return [ROOT_COMMON_POLICY, policyFor(agent).described ? ROOT_POLICY : '', policyFor(agent).claim].filter((part) => part !== '').join('\n\n')
      } catch {
        return ROOT_COMMON_POLICY
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
        // The common working policy goes to every root; the orchestration part is added when
        // the session runs POLICY_PRESET. The decision is taken when the prompt is assembled
        // (inside rootText), not when the section is registered; see POLICY_PRESET.
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
      agent.ctx.tools.register(reviewTool)
    }
  })
}

export { CHILD_POLICY }
