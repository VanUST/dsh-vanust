/**
 * PURPOSE
 *   A workspace task ledger with the fields the subagent catalog never had:
 *   objective, scope, non-scope, acceptance, status, owner, results and a timeline.
 *   The ledger is one JSON file in the session workspace (`.dsh/taskboard.json`),
 *   so it survives a Host restart, travels with the checkout, and is readable by
 *   the browser through the existing `workspaceFiles` Remote. The model writes it
 *   through tools; the browser writes it through the `/taskboard` command; both go
 *   through the same service, so there is one schema and one compare-and-set rule.
 *
 *   A CHAT HAS ITS OWN BOARD. Every task records the chat it belongs to (`chatId`,
 *   the root session of its lineage), reads default to that chat, and a task created
 *   by a delegated child lands on the parent chat's board. The file still holds the
 *   whole workspace history: `task_list` with the workspace scope reads it on
 *   request, and the panel has an explicit toggle. Fresh chat, fresh board, nothing
 *   lost - the two requirements pull in opposite directions, and one file with a chat
 *   column satisfies both without a second store to drift.
 *
 * INPUTS
 *   Config (all optional):
 *     file     ledger path relative to the session workspace. Default `.dsh/taskboard.json`.
 *     maxTasks tasks that can still be acted on (open, active, paused, review, blocked).
 *              Default 200. Terminal rows (done, cancelled) do not count against it.
 *     maxRows  hard row limit for the ledger file itself. Default 1000; a create past it is
 *              refused with `board_rows_full`, and nothing is evicted.
 *     timelineLimit maximum timeline entries per task. Default 120.
 *     staleAfterMs  how old an untouched role row must be to report `stale`.
 *                   Default 86400000 (one day).
 *
 * OUTPUTS
 *   A `taskboard` service (ctx.provide) used by the orchestrator's `delegate_task`
 *   and by these tools: task_create, task_get, task_list, task_update, task_note,
 *   task_link. A `/taskboard` command applies one JSON operation for the UI.
 *   No prompt section and no session event; the file is application state, not
 *   model history.
 *
 * KEYWORDS
 *   tasks, taskboard, ledger, scope, non-scope, results, timeline, delegation
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A missing ledger is an empty board, not an error.
 *   - A malformed ledger fails the operation loudly; silently replacing it would
 *     lose the human's edits.
 *   - A write is temp-file + rename, so a crash cannot leave half a JSON document.
 *   - A stale `expectedRevision` returns `stale` with the current task; it never
 *     overwrites the newer value.
 *   - A child start/end with no linked task is ignored; the orchestrator can link
 *     it later with `task_link`.
 *   - One process serializes writes per file with a promise chain; the file is the
 *     cross-process authority and is not locked across processes.
 *   - Role rows are annotated when read, never rewritten by a read: `orphan: true` when
 *     the row's lastTaskId is no longer in the board, `stale: true` when it has not been
 *     touched for staleAfterMs. Both mean "nothing is running behind this role" - measured
 *     2026-10-30: a row read `active` for four days after its chat died, and the panel
 *     counted it as a subagent.
 *   - Removing a task clears agent rows that point at it through lastTaskId, not only
 *     those reachable through the removed task's childSessionIds (a delegation that
 *     registered its role but never linked the task was invisible to that cleanup).
 *   - A task created by a delegated child belongs to the parent chat: `chatId` is the
 *     root of the session lineage (`parentSession`), found by walking the live agents,
 *     so a child's rows land on the board the human is looking at.
 *   - A task with no chat at all (legacy row, hand-written ledger) is visible in the
 *     workspace scope and writable only by the human. No chat can claim it, so no agent
 *     rewrites history it cannot see.
 *   - A write from another chat is refused with `other_chat` rather than landing on a
 *     board the caller cannot read; `task_get` still reads any task by id, because
 *     knowing the id is the reason to look.
 *   - A task is BORN OPEN (or blocked with a reason): `create` refuses any other starting
 *     status with `initial_status`, so `done` cannot be minted without an acceptance.
 *   - `task_cancel` is a lifecycle action, not a transition: it interrupts the children and
 *     then writes `cancelled`, which is the only door for a paused task and for a task that
 *     still has children (the transition table refuses a bare edit into those states).
 *   - `task_close` needs the result summary somebody wrote before it accepts; a linked child
 *     settling still moves the task to review, but "the child finished" is not an acceptance.
 *   - The command path (`/taskboard`, the human's panel) is a COMPARE-AND-SET like the tools:
 *     every mutating op needs the `expectedRevision` it read (`needs_revision` otherwise,
 *     `stale` when it moved). The model tools carry the revision in their schema; agents use
 *     the tools, the client uses the command.
 *   - The lifecycle is enforced HERE, in one function (`transitionRefusal`), because the
 *     model tools and the human's panel reach the same service. `open -> active` needs a
 *     specialist role AND an owner, or `inline: true` (`needs_role_or_inline`); `-> review`
 *     needs a result summary (`needs_result`) and one evidence item (`needs_evidence`);
 *     `-> blocked` needs a reason (`needs_reason`); paused and done are lifecycle tools
 *     (`use_pause`, `use_close`) and leaving paused is `use_resume`; done and cancelled are
 *     terminal (`terminal`); `task_close` accepts only a task in review (`needs_review`).
 *     A refusal is a value, not a throw: the caller quotes the code.
 *   - A row with `proposed` or `ready` was written before those two names were merged into
 *     `open`. It is DISPLAY-MAPPED on read (`displayStatus`) and never rewritten by a read:
 *     a save that does not change the state leaves the stored value alone. The board
 *     version therefore stays 1.
 *   - A task is never role-less: it carries a `role` (with the `preset` its child runs with)
 *     or `inline: true` for work the owner does itself. `create` refuses the third case with
 *     `needs_role_or_inline`; the panel labels a pre-rule row `unassigned` instead of
 *     pretending it has one.
 *   - The chat scope is resolved once per call from the live agent tree. A session
 *     whose parent is no longer loaded stops at the id it can prove, which is that
 *     session's own chat - never an invented root.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** Ledger format version. A different version is refused, never reinterpreted. */
const BOARD_VERSION = 1

/**
 * THE LIFECYCLE. Seven states, and no two of them mean the same thing.
 *
 *   open      created, nobody is working on it yet
 *   active    a specialist child or the owner itself is working on it
 *   paused    held, with its children interrupted; continue with task_resume
 *   review    work is claimed finished and waits for acceptance
 *   done      accepted. Only task_close (or the human) may set it
 *   blocked   cannot proceed; carries the `reason` it cannot
 *   cancelled terminal; not reachable from done
 *
 * `proposed` and `ready` were two names for "not started", which is why a board
 * could show a column nobody could act on. They are not states any more: rows
 * written before this merge are DISPLAY-MAPPED to `open` on read (see
 * `displayStatus`) and the file is never rewritten by a read. The board format
 * version stays 1 for the same reason.
 */
const STATUSES = ['open', 'active', 'paused', 'review', 'done', 'blocked', 'cancelled']
const PRIORITIES = ['low', 'normal', 'high']
/** The statuses an ordinary compare-and-set update may set: paused and done are lifecycle tools. */
const EDITABLE_STATUSES = ['open', 'active', 'review', 'blocked', 'cancelled']
/** The retired names, mapped on read only. */
const LEGACY_STATUS = { proposed: 'open', ready: 'open' }

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'taskboard'

/** The tools and command registries are required. */
export const inject = ['tools', 'commands']

/** Resolve the session workspace, falling back to the process directory. */
export function workingDir(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd()
}

/** A fresh task id: sortable enough for a board, unique enough for one workspace. */
function taskId() {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** ISO timestamp for durable records. */
function now() {
  return new Date().toISOString()
}

/**
 * The status a board SHOWS for a stored value.
 *
 * A row written before the merge still says `proposed` or `ready` in the file; both
 * meant "not started", so both read as `open`. Nothing about a read writes the file:
 * the mapping is applied to the projection, so an old row keeps its bytes until a
 * real transition replaces the value.
 *
 * @param value - The stored status.
 * @returns One of STATUSES; an unknown value reads as `open`, which is the state a
 *   task nobody has moved to is in.
 */
function displayStatus(value) {
  if (Object.hasOwn(LEGACY_STATUS, value)) return LEGACY_STATUS[value]
  return STATUSES.includes(value) ? value : 'open'
}

/** A status a WRITE may store: the retired names are folded into `open`. */
function statusOf(value, fallback = 'open') {
  if (Object.hasOwn(LEGACY_STATUS, value)) return LEGACY_STATUS[value]
  return STATUSES.includes(value) ? value : fallback
}

/** A task's specialty: a role with its preset, or `inline` for work the owner does itself. */
function assignmentOf(task) {
  const role = typeof task?.role === 'string' && task.role.trim() !== '' ? task.role.trim() : ''
  if (role !== '') return { role, preset: typeof task?.preset === 'string' && task.preset !== '' ? task.preset : null, inline: false }
  return { role: null, preset: null, inline: task?.inline === true }
}

/** A priority the schema accepts, or `normal`. */
function priorityOf(value) {
  return PRIORITIES.includes(value) ? value : 'normal'
}

/** Strings, trimmed, deduplicated, with empty entries dropped. */
function strings(value, limit = 50) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const text = entry.trim()
    if (text === '' || seen.has(text)) continue
    seen.add(text)
    out.push(text.slice(0, 500))
    if (out.length >= limit) break
  }
  return out
}

/** Acceptance items accept either strings or `{text, done}` objects. */
function acceptance(value, existing = []) {
  if (!Array.isArray(value)) return []
  const previous = new Map()
  for (const entry of Array.isArray(existing) ? existing : []) {
    const text = typeof entry === 'string' ? entry : entry?.text
    if (typeof text !== 'string' || text.trim() === '') continue
    const key = text.trim().slice(0, 500)
    if (!previous.has(key)) previous.set(key, [])
    previous.get(key).push(entry !== null && typeof entry === 'object' && entry.done === true)
  }
  const out = []
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim() !== '') {
      const text = entry.trim().slice(0, 500)
      const queue = previous.get(text)
      out.push({ text, done: Array.isArray(queue) && queue.length > 0 ? queue.shift() === true : false })
    } else if (entry !== null && typeof entry === 'object' && typeof entry.text === 'string' && entry.text.trim() !== '') {
      out.push({ text: entry.text.trim().slice(0, 500), done: entry.done === true })
    }
    if (out.length >= 50) break
  }
  return out
}

/** A result object from the fields the tools accept. */
function resultOf(input, existing = undefined) {
  const result = existing !== null && typeof existing === 'object' ? { ...existing } : {}
  if (input !== null && typeof input === 'object' && Object.hasOwn(input, 'summary')) {
    if (typeof input.summary === 'string' && input.summary.trim() !== '') result.summary = input.summary.trim().slice(0, 4000)
    else delete result.summary
  }
  for (const key of ['evidence', 'artifacts', 'decisions', 'risks']) {
    if (input === null || typeof input !== 'object' || !Object.hasOwn(input, key)) continue
    const list = strings(input[key], 50)
    if (list.length > 0) result[key] = list
    else delete result[key]
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * The acceptance gate: a result is a claim only when it says what was achieved and carries at
 * least one piece of evidence. The same check guards a move to review and an acceptance, so a
 * close cannot accept a result a review would have refused.
 */
function acceptanceRefusal(result) {
  if (typeof result?.summary !== 'string' || result.summary.trim() === '') return 'needs_result'
  if (!Array.isArray(result?.evidence) || result.evidence.length === 0) return 'needs_evidence'
  return null
}

/**
 * Fill the result fields supplied at acceptance, without rewriting anything already recorded.
 *
 * WHY FILL-ONLY. A batch cleanup accepts rows whose children already settled; their result is
 * the only record of what happened, and a shared cleanup summary must not overwrite it. The
 * same rule lets one call fill the 19 legacy rows that are in review with no result at all:
 * the supplied summary lands only where there is none, and the evidence list is filled only
 * when it is empty.
 *
 * @param existing - The task's stored result, if any.
 * @param incoming - Result fields supplied with the close; absent means keep the stored result.
 * @returns A new result object; the stored object is never mutated.
 */
function fillResult(existing, incoming) {
  const base = existing !== null && typeof existing === 'object' ? { ...existing } : {}
  const provided = resultOf(incoming)
  if (provided === undefined) return base
  if ((typeof base.summary !== 'string' || base.summary.trim() === '') && typeof provided.summary === 'string') {
    base.summary = provided.summary
  }
  for (const key of ['evidence', 'artifacts', 'decisions', 'risks']) {
    const current = Array.isArray(base[key]) ? base[key] : []
    if (current.length === 0 && Array.isArray(provided[key]) && provided[key].length > 0) base[key] = provided[key]
  }
  return base
}

/** Append one timeline event and trim the oldest entries. */
function timeline(task, kind, actor, text, extra = {}, limit = 120) {
  const entry = { at: now(), kind, actor, text: String(text).slice(0, 1000), ...extra }
  task.timeline = [...(Array.isArray(task.timeline) ? task.timeline : []), entry].slice(-limit)
}

/**
 * Why one status change is refused, or null when the Host accepts it.
 *
 * The rules live HERE, not in the panel. A model tool and the human's panel go through
 * the same service, so a UI that forgot a rule cannot write a board the Host would have
 * refused; every refusal names itself with a code the caller can quote.
 *
 *   needs_role_or_inline  open -> active without a specialist role AND owner, and not inline
 *   needs_result          -> review without a result summary, or task_close without one
 *   needs_evidence        -> review without one evidence item
 *   needs_reason          -> blocked without a reason, or a BLANK reason on a blocked task
 *   initial_status        task_create with any status other than open (or blocked with a reason)
 *   needs_revision        a command-path write without the revision it read (the CAS)
 *   use_pause             -> paused through an ordinary update
 *   use_close             -> done through an ordinary update
 *   use_resume            any move out of paused through an ordinary update
 *   terminal              any move out of done or cancelled
 *   needs_review          task_close on a task that is not in review
 *
 * @param task - The stored task.
 * @param patch - The requested patch.
 * @returns The refusal code, or null.
 */
function transitionRefusal(task, patch) {
  if (patch === null || typeof patch !== 'object') return null
  const from = displayStatus(task.status)
  // A BLANK REASON IS NOT A REASON. On the way into blocked it is a missing reason; on an
  // already-blocked task it would silently erase what the task waits on, which is why this
  // check sits BEFORE the "no transition" early return. An untouched reason (the key absent)
  // keeps the current text.
  const enteringBlocked = patch.status !== undefined && statusOf(patch.status, from) === 'blocked'
  if (typeof patch.reason === 'string' && patch.reason.trim() === '' && (from === 'blocked' || enteringBlocked)) return 'needs_reason'
  if (patch.status === undefined) return null
  const to = statusOf(patch.status, from)
  if (to === from) return null
  if (to === 'paused') return 'use_pause'
  if (to === 'done') return 'use_close'
  if (from === 'paused') return 'use_resume'
  // cancelled is terminal, and done is the one state acceptance reached: neither can be
  // reopened by an edit. That is what makes "done" mean accepted rather than touched last.
  if (from === 'done' || from === 'cancelled') return 'terminal'
  if (to === 'cancelled' && Array.isArray(task.childSessionIds) && task.childSessionIds.length > 0) return 'use_close'
  if (to === 'active') {
    // A task that starts moving belongs to somebody: a specialist role with an owner, or
    // inline work the owner does itself. A role without an owner is a task nobody picked up.
    // The assignment may arrive in the same patch (`inline`, `role`, `owner`), which is how
    // a pre-role row is adopted instead of edited in two steps.
    const role = typeof patch.role === 'string' && patch.role.trim() !== '' ? patch.role.trim() : (typeof task.role === 'string' ? task.role.trim() : '')
    const owner = patch.owner !== undefined && patch.owner !== null && typeof patch.owner === 'object' ? patch.owner : (patch.owner === null ? null : task.owner)
    const owned = owner !== null && typeof owner === 'object' && typeof owner.label === 'string' && owner.label.trim() !== ''
    const inline = patch.inline === true || (patch.inline !== false && task.inline === true)
    if (!inline && (role === '' || !owned)) return 'needs_role_or_inline'
  }
  if (to === 'review') {
    const result = patch.result !== undefined ? resultOf(patch.result, task.result) : task.result
    const refusal = acceptanceRefusal(result)
    if (refusal !== null) return refusal
  }
  if (to === 'blocked') {
    const reason = typeof patch.reason === 'string' && patch.reason.trim() !== '' ? patch.reason.trim() : (typeof task.reason === 'string' ? task.reason.trim() : '')
    if (reason === '') return 'needs_reason'
  }
  return null
}

/** The statuses a NEW task may start in. Everything else is reached by a transition. */
export const INITIAL_STATUSES = ['open', 'blocked']

/**
 * The statuses a task can still be acted on in. `done` and `cancelled` are history: they are
 * the record of work that finished, and counting them against a cap on WORK IN FLIGHT is
 * what made a 198-row board with almost nothing active refuse a new task.
 */
const ACTIVE_STATUSES = ['open', 'active', 'paused', 'review', 'blocked']

/** The row count past which the FILE, not the work, is the thing at risk. */
const DEFAULT_MAX_ROWS = 1000

/** The most ids one batch lifecycle call may carry. A cleanup batch is tens of rows, not thousands. */
const MAX_BATCH = 100

/** Every command operation that edits or removes a row, and therefore needs its revision. */
const MUTATING_OPS = ['update', 'note', 'link', 'pause', 'resume', 'close', 'cancel', 'remove']

/**
 * A board read from disk, or the empty board when the file does not exist.
 *
 * @param path - Absolute ledger path.
 * @returns The parsed board.
 */
function readBoard(path) {
  if (!existsSync(path)) return { version: BOARD_VERSION, revision: 0, tasks: [], agents: [] }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`taskboard: ${path} is not valid JSON: ${error.message}`)
  }
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.tasks)) {
    throw new Error(`taskboard: ${path} has no tasks array`)
  }
  if (parsed.version !== BOARD_VERSION) {
    throw new Error(`taskboard: ${path} has version ${JSON.stringify(parsed.version)}; this plugin writes version ${BOARD_VERSION}`)
  }
  if (!Array.isArray(parsed.tasks)) throw new Error(`taskboard: ${path} has no tasks array`)
  const malformed = parsed.tasks.filter((task) => task === null || typeof task !== 'object' || typeof task.id !== 'string')
  if (malformed.length > 0) throw new Error(`taskboard: ${path} has ${malformed.length} malformed task record(s); refusing to drop them`)
  const agents = Array.isArray(parsed.agents)
    ? parsed.agents.filter((agent) => agent !== null && typeof agent === 'object' && typeof agent.role === 'string' && typeof agent.sessionId === 'string')
    : []
  return {
    version: BOARD_VERSION,
    revision: Number.isSafeInteger(parsed.revision) ? parsed.revision : 0,
    tasks: parsed.tasks,
    agents,
  }
}

/**
 * Write a board atomically.
 *
 * @param path - Absolute ledger path.
 * @param board - Complete board.
 */
function writeBoard(path, board) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, `${JSON.stringify(board, null, 2)}\n`, 'utf8')
  renameSync(temp, path)
}

/** A role row untouched for this long is a tombstone, not an active specialist. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000

/** A role label without its case and spacing, so BACKEND, Backend and back-end meet. */
function normalizeAgentRole(value) {
  return String(value ?? '').trim().toLowerCase()
}

/** The stop reasons that mean the child did NOT finish its work. */
const FAILED_STOP_REASONS = ['error', 'aborted', 'interrupted', 'cancelled', 'timeout', 'failed']

/**
 * Reconcile tasks the ledger can prove nobody is working on, without touching a live child.
 *
 * WHY. `childEnded` is the live path, and it only fires for a child this process saw settle.
 * A child that dies with its chat, or a Host that stops between the child's last event and
 * the ledger write, leaves `active` rows whose children are all finished - the state read as
 * "work in flight" forever. Measured in ~/tasks/autolabel_pipeline (2026-11-11): RESEARCH task
 * task-mwc4h93k-2v3s0c stayed `active` after child d864c24f ended with `error` at 32 s.
 *
 * WHAT IT MAY DECIDE. Only what the ledger itself records: a task with linked children whose
 * every `children[]` entry is settled (status not `active`/`paused`) has no running child. A
 * child with no `children[]` entry at all is NOT evidence of anything - it may be running -
 * so the row is reported as `unknown` and left alone. A task with no linked children is the
 * root's own inline work and is skipped.
 *
 * @param board - Parsed board; mutated in place.
 * @param limit - Timeline entries per task.
 * @returns Counts and the ids it changed, so a caller can quote them.
 */
export function reconcileTasks(board, limit = 120) {
  const result = { checked: 0, fixed: 0, blocked: 0, review: 0, running: 0, unknown: 0, ids: [] }
  for (const task of Array.isArray(board?.tasks) ? board.tasks : []) {
    if (displayStatus(task?.status) !== 'active') continue
    const linked = Array.isArray(task.childSessionIds) ? task.childSessionIds.filter((id) => typeof id === 'string' && id !== '') : []
    if (linked.length === 0) continue
    result.checked += 1
    const children = Array.isArray(task.children) ? task.children : []
    const known = linked.map((id) => children.find((entry) => entry?.sessionId === id))
    if (known.some((entry) => entry !== undefined && (entry.status === 'active' || entry.status === 'paused'))) {
      // A genuinely running child is never touched: that is the one claim `active` makes.
      result.running += 1
      continue
    }
    if (known.some((entry) => entry === undefined)) {
      result.unknown += 1
      continue
    }
    const failed = known.filter((entry) => FAILED_STOP_REASONS.includes(String(entry.stopReason ?? '').toLowerCase()))
    task.status = failed.length === 0 ? 'review' : 'blocked'
    if (failed.length > 0) task.reason = `reconciled: child ${failed[0].sessionId} ended with ${failed[0].stopReason}`
    task.revision = (Number.isSafeInteger(task.revision) ? task.revision : 1) + 1
    task.updatedAt = now()
    timeline(task, 'reconciled', 'orchestrator', failed.length === 0
      ? `Task moved to review: its ${linked.length} linked child session(s) had all settled`
      : `Task blocked: child ${failed[0].sessionId} ended with ${failed[0].stopReason}`, { sessionIds: linked }, limit)
    result.fixed += 1
    result[failed.length === 0 ? 'review' : 'blocked'] += 1
    result.ids.push(task.id)
  }
  return result
}

/**
 * Mark role rows with what the ledger can actually know.
 *
 * WHY THIS EXISTS. A specialist session belongs to the chat that started it, so after
 * that chat ends the row is a tombstone - and nothing used to clear it. Measured on a
 * real board (2026-10-30): a role still read `active` four days after its chat died, its
 * lastTaskId pointed at a task that had been removed, and the panel header counted it as
 * a running subagent. The ledger cannot ask the runtime whether a session is live, so it
 * reports the two things it CAN prove: the task it claims is gone, and it has not been
 * touched for a day.
 *
 * @param board - Parsed board.
 * @returns Copies of the role rows with `stale` and/or `orphan` set.
 */
function annotateAgents(board, staleAfterMs = STALE_AFTER_MS) {
  const ids = new Set((Array.isArray(board?.tasks) ? board.tasks : []).map((task) => task.id))
  const nowMs = Date.now()
  const rows = Array.isArray(board?.agents) ? board.agents : []
  // A ROLE IS (name, preset), and the LEDGER must say when it cannot be one. `preset` is the
  // child's tool composition: a row without one predates the roster, so reusing its session
  // would run a brief on a composition nobody chose (`legacy`). Two rows with one name and two
  // presets is the AUDIT split that never happened - the old ledger keyed on the label alone
  // and let the later write win silently (`conflict`).
  const byLabel = new Map()
  for (const row of rows) {
    const label = normalizeAgentRole(row?.role)
    if (label === '') continue
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1)
  }
  return rows.map((agent) => {
    const lastTaskId = typeof agent.lastTaskId === 'string' ? agent.lastTaskId : ''
    const orphan = lastTaskId !== '' && !ids.has(lastTaskId)
    const updated = Date.parse(String(agent.updatedAt ?? agent.createdAt ?? ''))
    const stale = Number.isNaN(updated) ? false : nowMs - updated > staleAfterMs
    const legacy = typeof agent.preset !== 'string' || agent.preset.trim() === ''
    const conflict = (byLabel.get(normalizeAgentRole(agent.role)) ?? 0) > 1
    return {
      ...agent,
      ...(orphan ? { orphan: true } : {}),
      ...(stale ? { stale: true } : {}),
      ...(legacy ? { legacy: true } : {}),
      ...(conflict ? { conflict: true } : {}),
    }
  })
}

/**
 * Build the ledger service.
 *
 * @param config - Raw plugin config.
 * @param logger - Cordis logger, for the one warning the service emits.
 * @returns The service placed on `ctx.taskboard`.
 */
function createService(config, logger, hooks = {}) {
  const file = typeof config.file === 'string' && config.file !== '' ? config.file : '.dsh/taskboard.json'
  // `maxTasks` keeps its name and its default (200) but counts tasks that can still be
  // ACTED ON; `maxRows` bounds the file itself, which grows forever without it.
  const maxTasks = Number.isSafeInteger(config.maxTasks) && config.maxTasks > 0 ? config.maxTasks : 200
  const maxRows = Number.isSafeInteger(config.maxRows) && config.maxRows > 0 ? config.maxRows : DEFAULT_MAX_ROWS
  const timelineLimit = Number.isSafeInteger(config.timelineLimit) && config.timelineLimit > 0 ? config.timelineLimit : 120
  const staleAfterMs = Number.isSafeInteger(config.staleAfterMs) && config.staleAfterMs > 0 ? config.staleAfterMs : STALE_AFTER_MS
  const linksFile = typeof config.linksFile === 'string' && config.linksFile !== '' ? config.linksFile : join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'taskboard-child-links.json')
  /** Persisted child -> task/workspace links survive a Host or plugin reload. */
  const readLinks = () => {
    if (!existsSync(linksFile)) return {}
    try {
      const value = JSON.parse(readFileSync(linksFile, 'utf8'))
      return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
    } catch (error) {
      logger?.warn?.(`taskboard: could not read child links ${linksFile}: ${error.message}`)
      return {}
    }
  }
  const writeLinks = (map) => {
    try {
      mkdirSync(dirname(linksFile), { recursive: true })
      const temp = `${linksFile}.${process.pid}.tmp`
      writeFileSync(temp, `${JSON.stringify(Object.fromEntries(map), null, 2)}\n`)
      renameSync(temp, linksFile)
    } catch (error) {
      logger?.warn?.(`taskboard: could not write child links ${linksFile}: ${error.message}`)
    }
  }
  const normalizeLinkEntry = (value) => {
    if (Array.isArray(value)) return value.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.cwd === 'string' && typeof entry.id === 'string')
    return value !== null && typeof value === 'object' && typeof value.cwd === 'string' && typeof value.id === 'string' ? [value] : []
  }
  const childLinks = new Map(Object.entries(readLinks()).map(([childId, value]) => [childId, normalizeLinkEntry(value)]))

  /** Absolute ledger path for a session directory. */
  const pathFor = (cwd) => isAbsolute(file) ? file : resolve(cwd, file)

  /**
   * Read one board, run a synchronous operation, and write it atomically when
   * the operation reports a change. The ledger is a small JSON file and every
   * mutation is synchronous, so two callers cannot interleave inside one turn.
   */
  const mutate = (cwd, operation) => {
    const path = pathFor(cwd)
    const board = readBoard(path)
    const before = board.revision
    const result = operation(board)
    const changed = board.revision !== before || result?.changed === true
    if (changed) {
      board.revision = before + 1
      writeBoard(path, { ...board, tasks: board.tasks, agents: board.agents ?? [] })
    }
    return result?.value ?? result
  }

  /**
   * The chat a task belongs to: the root session recorded at creation, or - for a row
   * written before chats had boards - the session that created it. A row with neither
   * is workspace history that no chat owns.
   */
  const chatOf = (task) => {
    if (typeof task?.chatId === 'string' && task.chatId !== '') return task.chatId
    return typeof task?.parentSessionId === 'string' && task.parentSessionId !== '' ? task.parentSessionId : null
  }

  /**
   * Whether a caller may write a task. An empty chatId is the unscoped path (a child
   * settling, a link the orchestrator makes without a session), the human owns the whole
   * board including rows no chat claims, and an agent owns exactly the chat it works in.
   */
  const writable = (task, chatId, actor) => {
    if (chatId === '' || actor === 'human') return true
    const owner = chatOf(task)
    return owner !== null && owner === chatId
  }
  const otherChat = (task) => ({ value: { ok: false, code: 'other_chat', chatId: chatOf(task) } })

  /**
   * Interrupt every linked child of one task and report per-child outcomes.
   *
   * The hook is the only path to the subagent runtime; it throws when the child cannot be
   * stopped, and the caller fails closed (the task keeps its previous status). Nothing is
   * mutated here: a batch that writes other rows must not persist a half-stopped task.
   */
  const interruptChildren = (task, requestedParent) => {
    const parentSessionId = typeof task.parentSessionId === 'string' && task.parentSessionId !== ''
      ? task.parentSessionId
      : (typeof requestedParent === 'string' ? requestedParent : '')
    const interrupted = []
    const errors = []
    for (const childId of Array.isArray(task.childSessionIds) ? task.childSessionIds : []) {
      if (typeof hooks.interrupt !== 'function') {
        errors.push(childId + ': subagent service is unavailable')
        continue
      }
      try {
        hooks.interrupt(childId, parentSessionId)
        interrupted.push(childId)
      } catch (error) {
        errors.push(childId + ': ' + (error instanceof Error ? error.message : String(error)))
      }
    }
    return { parentSessionId, interrupted, errors }
  }

  /** Record a committed stop on the task's child rows and the workspace role rows. */
  const markChildren = (board, task, childStatus, agentStatus) => {
    const children = Array.isArray(task.children) ? task.children : []
    for (const childId of Array.isArray(task.childSessionIds) ? task.childSessionIds : []) {
      const child = children.find((entry) => entry.sessionId === childId)
      if (child !== undefined) child.status = childStatus
      const agent = (board.agents ?? []).find((entry) => entry.sessionId === childId)
      if (agent !== undefined) {
        agent.status = agentStatus
        agent.updatedAt = now()
      }
    }
    task.children = children
  }

  /** The batch ids a close/cancel tool was given, deduplicated and bounded. */
  const batchIds = (input) => {
    const raw = Array.isArray(input?.ids) ? input.ids : (typeof input?.id === 'string' && input.id !== '' ? [input.id] : [])
    const ids = []
    for (const value of raw) {
      if (typeof value !== 'string' || value.trim() === '') continue
      const id = value.trim()
      if (!ids.includes(id)) ids.push(id)
    }
    return ids
  }

  /** Per-task result entries, keyed by task id. */
  const perTaskResults = (input) => {
    const map = new Map()
    if (!Array.isArray(input?.results)) return map
    for (const entry of input.results) {
      if (entry !== null && typeof entry === 'object' && typeof entry.id === 'string' && entry.id !== '') map.set(entry.id, entry)
    }
    return map
  }

  /**
   * Cancel one task after its children stop. Returns a plain outcome so the single tool and a
   * batch share one rule: a refused interrupt cancels nothing, and a task already cancelled is
   * an accepted no-op.
   */
  const cancelOne = (board, task, input, reason) => {
    const chatId = typeof input?.chatId === 'string' ? input.chatId : ''
    if (!writable(task, chatId, input?.actor)) return { ok: false, code: 'other_chat', chatId: chatOf(task) }
    const from = displayStatus(task.status)
    if (from === 'cancelled') return { ok: true, task, interrupted: [], errors: [], note: 'already cancelled' }
    if (from === 'done') return { ok: false, code: 'terminal', task }
    const { interrupted, errors } = interruptChildren(task, input?.parentSessionId)
    if (errors.length > 0) return { ok: false, code: 'interrupt_failed', task, interrupted, errors }
    markChildren(board, task, 'sleeping', 'sleeping')
    task.status = 'cancelled'
    const note = reason === '' ? 'Cancelled with no reason given' : 'Cancelled: ' + reason
    const result = resultOf({ decisions: [note] }, task.result)
    if (result !== undefined) task.result = result
    task.revision += 1
    task.updatedAt = now()
    timeline(task, 'cancelled', input?.actor === 'human' ? 'human' : 'orchestrator', note, { sessionIds: interrupted }, timelineLimit)
    return { ok: true, task, interrupted, errors, note, changed: true }
  }

  /**
   * Accept one task after checking its result. The result supplied at acceptance fills only
   * missing fields; a summary already recorded is never rewritten. No board mutation happens
   * until the result gate and the child stop both pass, so a batch can persist other rows
   * without persisting a half-accepted one.
   */
  const closeOne = (board, task, input, incoming) => {
    const chatId = typeof input?.chatId === 'string' ? input.chatId : ''
    if (!writable(task, chatId, input?.actor)) return { ok: false, code: 'other_chat', chatId: chatOf(task) }
    const from = displayStatus(task.status)
    if (from === 'cancelled') return { ok: false, code: 'cancelled', task }
    if (from === 'done') return { ok: true, task, interrupted: [], errors: [], note: 'already done' }
    if (from !== 'review') return { ok: false, code: 'needs_review', task }
    const next = fillResult(task.result, incoming)
    const refusal = acceptanceRefusal(next)
    if (refusal !== null) return { ok: false, code: refusal, task }
    const { interrupted, errors } = interruptChildren(task, input?.parentSessionId)
    if (errors.length > 0) return { ok: false, code: 'interrupt_failed', task, interrupted, errors }
    const recorded = JSON.stringify(next) !== JSON.stringify(task.result ?? {})
    task.result = Object.keys(next).length > 0 ? next : undefined
    markChildren(board, task, 'sleeping', 'sleeping')
    task.status = 'done'
    task.revision += 1
    task.updatedAt = now()
    timeline(task, 'closed', input?.actor === 'human' ? 'human' : 'orchestrator', 'Closed as done' + (recorded ? '; result recorded at acceptance' : ''), { sessionIds: interrupted }, timelineLimit)
    return { ok: true, task, interrupted, errors, changed: true, resultRecorded: recorded }
  }

  /** Compact list row; the board UI uses the full task document. */
  const summary = (task) => {
    const assignment = assignmentOf(task)
    return {
      id: task.id,
      chatId: chatOf(task),
      title: task.title,
      // The projection, never the stored value: a reader of a pre-merge row sees the
      // state the board means, and the file keeps the bytes it had.
      status: displayStatus(task.status),
      role: assignment.role,
      preset: assignment.preset,
      inline: assignment.inline,
      priority: task.priority,
      owner: task.owner?.label ?? null,
      reason: typeof task.reason === 'string' && task.reason !== '' ? task.reason : null,
      childSessionIds: task.childSessionIds ?? [],
      children: Array.isArray(task.children) ? task.children : [],
      revision: task.revision,
      updatedAt: task.updatedAt,
    }
  }

  return {
    file,
    pathFor,
    /** One chat's board, or the whole workspace with `all`. */
    list(cwd, options = {}) {
      const chatId = typeof options?.chatId === 'string' ? options.chatId : ''
      const all = options?.all === true
      return readBoard(pathFor(cwd)).tasks
        .filter((task) => all || chatId === '' || chatOf(task) === chatId)
        .map(summary)
    },
    /** Persistent specialists for one workspace, with stale/orphan flags. */
    agents(cwd) {
      return annotateAgents(readBoard(pathFor(cwd)), staleAfterMs)
    },
    /** Find one persistent specialist by role (case-insensitive). */
    findAgent(cwd, role) {
      const wanted = typeof role === 'string' ? role.trim().toLowerCase() : ''
      if (wanted === '') return undefined
      return annotateAgents(readBoard(pathFor(cwd)), staleAfterMs).find((agent) => agent.role.trim().toLowerCase() === wanted)
    },
    /** Create or update a persistent specialist role and its child session. */
    registerAgent(cwd, input) {
      const role = typeof input?.role === 'string' ? input.role.trim().slice(0, 80) : ''
      const sessionId = typeof input?.sessionId === 'string' ? input.sessionId : ''
      if (role === '' || sessionId === '') return { ok: false, code: 'invalid_agent' }
      const label = typeof input?.label === 'string' && input.label !== '' ? input.label.slice(0, 200) : role
      const chatSessionId = typeof input?.chatSessionId === 'string' && input.chatSessionId !== '' ? input.chatSessionId : ''
      // The preset the child was actually started with. Reuse is only safe against the same
      // tool set, so the row records it; a row from before presets has no value and is
      // treated as a mismatch by the delegator rather than assumed compatible.
      const preset = typeof input?.preset === 'string' && input.preset !== '' ? input.preset.slice(0, 80) : ''
      const force = input?.force === true
      return mutate(cwd, (board) => {
        const agents = Array.isArray(board.agents) ? board.agents : []
        const existing = agents.find((agent) => normalizeAgentRole(agent.role) === normalizeAgentRole(role))
        const time = now()
        // A ROLE LABEL OWNS ONE TOOL SET. Reusing the label with another preset used to
        // overwrite the recorded composition in place, so `AUDIT [reviewer]` became
        // `AUDIT [critic]` between two delegations and the catalog showed one role where two
        // specialties had been used - measured in ~/tasks/autolabel_pipeline (2026-11-11,
        // revision 1906): a reviewer row and a critic row collapsed into `AUDIT [critic]`.
        // The ledger keeps ONE row per label and refuses the switch; splitting the label
        // (REVIEWER / CRITIC, or a genuinely new name) is the caller's decision, and `force`
        // is the recorded exception for correcting a row that was wrong.
        const recorded = typeof existing?.preset === 'string' ? existing.preset.trim() : ''
        if (existing !== undefined && recorded !== '' && preset !== '' && recorded !== preset && !force) {
          return { value: { ok: false, code: 'preset_conflict', role: existing.role, recorded, requested: preset } }
        }
        if (existing === undefined) {
          agents.push({
            role,
            label,
            sessionId,
            status: 'active',
            taskCount: 1,
            lastTaskId: input?.taskId ?? null,
            generation: 1,
            history: [],
            ...(preset === '' ? {} : { preset }),
            ...(chatSessionId === '' ? {} : { chatSessionId }),
            createdAt: time,
            updatedAt: time,
          })
        } else {
          // A role is durable, the agent behind it is not: a specialist session belongs
          // to the chat that created it, so a later chat gets a NEW child and this row is
          // repointed. Keeping the superseded ids in the history array is what makes that
          // visible - silently overwriting the field is how the ledger used to claim a
          // persistence the subagent runtime refuses.
          if (existing.sessionId !== sessionId) {
            const history = Array.isArray(existing.history) ? existing.history : []
            existing.history = [
              ...history,
              {
                sessionId: existing.sessionId,
                chatSessionId: typeof existing.chatSessionId === 'string' ? existing.chatSessionId : null,
                replacedAt: time,
              },
            ].slice(-8)
            existing.generation = (Number.isSafeInteger(existing.generation) ? existing.generation : 1) + 1
          }
          existing.label = label
          existing.sessionId = sessionId
          if (preset !== '') {
            // A row from before presets has no composition to switch away from: adopting one
            // the caller passed explicitly is the upgrade, and it is written down so a reader
            // can tell an adopted role from one that was born with its tool set.
            if (recorded === '') {
              const history = Array.isArray(existing.history) ? existing.history : []
              existing.history = [...history, { preset, adoptedAt: time, from: null }].slice(-8)
            } else if (recorded !== preset && force) {
              const history = Array.isArray(existing.history) ? existing.history : []
              existing.history = [...history, { preset, replacedPreset: recorded, replacedAt: time, forced: true }].slice(-8)
            }
            existing.preset = preset
          }
          if (chatSessionId !== '') existing.chatSessionId = chatSessionId
          existing.status = 'active'
          existing.updatedAt = time
          if (typeof input?.taskId === 'string' && input.taskId !== '' && input.taskId !== existing.lastTaskId) {
            existing.lastTaskId = input.taskId
            existing.taskCount = Number.isSafeInteger(existing.taskCount) ? existing.taskCount + 1 : 1
          }
        }
        board.agents = agents
        return { changed: true, value: { ok: true, agent: agents.find((agent) => normalizeAgentRole(agent.role) === normalizeAgentRole(role)) } }
      })
    },
    /** Update one specialist by session id. */
    touchAgent(cwd, input) {
      const sessionId = typeof input?.sessionId === 'string' ? input.sessionId : ''
      if (sessionId === '') return { ok: false, code: 'invalid_agent' }
      return mutate(cwd, (board) => {
        const agent = (board.agents ?? []).find((entry) => entry.sessionId === sessionId)
        if (agent === undefined) return { value: { ok: false, code: 'not_found' } }
        if (typeof input.status === 'string') agent.status = input.status
        if (typeof input?.taskId === 'string' && input.taskId !== '' && input.taskId !== agent.lastTaskId) {
          agent.lastTaskId = input.taskId
          agent.taskCount = Number.isSafeInteger(agent.taskCount) ? agent.taskCount + 1 : 1
        }
        agent.updatedAt = now()
        return { changed: true, value: { ok: true, agent } }
      })
    },
    /** One full task, or undefined. */
    get(cwd, id) {
      return readBoard(pathFor(cwd)).tasks.find((task) => task.id === id)
    },
    /** Create a task; returns the full record, or a named refusal. */
    create(cwd, input, actor = 'orchestrator') {
      const title = typeof input?.title === 'string' ? input.title.trim() : ''
      if (title === '') throw new Error('taskboard: a task needs a non-empty title')
      // NO ROLE-LESS TASK. A task belongs to a specialist role (which carries the preset
      // its child runs with) or it is explicitly inline work the owner does itself. The
      // refusal is here rather than in the panel because `delegate_task`, `task_create`
      // and the UI all reach this one function.
      const role = typeof input?.role === 'string' ? input.role.trim().slice(0, 80) : ''
      const inline = role === '' && input?.inline === true
      if (role === '' && !inline) return { ok: false, code: 'needs_role_or_inline' }
      // A TASK IS BORN OPEN. `done` means accepted and `cancelled` means abandoned: neither can
      // be a starting point, and `paused`/`active`/`review` each claim something that has not
      // happened yet. Only `blocked` is a real starting state, and only with its reason.
      const initial = input?.status === undefined ? 'open' : displayStatus(input.status)
      if (!INITIAL_STATUSES.includes(initial)) return { ok: false, code: 'initial_status', status: initial, allowed: INITIAL_STATUSES }
      // The caller may pass the resolved chat, or only the session that asked; the hook
      // walks that session to its root so a child's Task lands on the parent's board.
      const chatId = typeof input?.chatId === 'string' && input.chatId !== ''
        ? input.chatId
        : (typeof input?.parentSessionId === 'string' && input.parentSessionId !== '' && typeof hooks.rootOf === 'function' ? hooks.rootOf(input.parentSessionId) : '')
      return mutate(cwd, (board) => {
        const time = now()
        // THE CAP IS ON WORK IN FLIGHT, NOT ON HISTORY. A board that finished 190 tasks and
        // has 5 open ones is not full; it is healthy. Two separate limits, two codes:
        //   board_full      - too much work is open, paused, waiting for review or blocked
        //   board_rows_full - the ledger file itself is at its row limit (a scale guard, so a
        //                     board cannot grow without bound); nothing is ever deleted or
        //                     rewritten to make room.
        const active = board.tasks.filter((task) => ACTIVE_STATUSES.includes(displayStatus(task?.status))).length
        if (active >= maxTasks) {
          return { value: { ok: false, code: 'board_full', active, cap: maxTasks, message: `${active} of ${maxTasks} tasks can still be acted on; close or cancel what is finished, or raise maxTasks` } }
        }
        if (board.tasks.length >= maxRows) {
          return { value: { ok: false, code: 'board_rows_full', rows: board.tasks.length, cap: maxRows, message: `the ledger holds ${board.tasks.length} rows (limit ${maxRows}); the file, not the work, is full - nothing is deleted automatically, so raise maxRows` } }
        }
        const task = {
          id: taskId(),
          revision: 1,
          title: title.slice(0, 200),
          objective: typeof input?.objective === 'string' ? input.objective.slice(0, 4000) : '',
          scope: strings(input?.scope),
          nonScope: strings(input?.nonScope),
          acceptance: acceptance(input?.acceptance),
          status: initial,
          priority: priorityOf(input?.priority),
          ...(role === '' ? {} : { role }),
          // The role IS the owner until a specialist session links: it says who the work
          // belongs to, which is what open -> active requires.
          ...(role === '' ? {} : { owner: { kind: 'agent', label: role } }),
          ...(inline ? { inline: true } : {}),
          ...(role !== '' && typeof input.preset === 'string' && input.preset.trim() !== '' ? { preset: input.preset.trim().slice(0, 80) } : {}),
          ...(typeof input?.reason === 'string' && input.reason.trim() !== '' ? { reason: input.reason.trim().slice(0, 1000) } : {}),
          ...(chatId === '' ? {} : { chatId }),
          ...(typeof input?.parentSessionId === 'string' && input.parentSessionId !== '' ? { parentSessionId: input.parentSessionId } : {}),
          ...(typeof input?.parentId === 'string' && input.parentId !== '' ? { parentId: input.parentId } : {}),
          dependsOn: strings(input?.dependsOn),
          childSessionIds: [],
          children: [],
          ...(resultOf(input?.result) === undefined ? {} : { result: resultOf(input?.result) }),
          timeline: [],
          createdAt: time,
          updatedAt: time,
        }
        // A row may be created straight into blocked only with the reason it is blocked on.
        if (displayStatus(task.status) === 'blocked' && task.reason === undefined) return { value: { ok: false, code: 'needs_reason' } }
        timeline(task, 'created', actor, `Created: ${task.title}`, {}, timelineLimit)
        board.tasks.push(task)
        return { changed: true, value: task }
      })
    },
    /** Compare-and-set update; a stale revision returns the current task untouched. */
    update(cwd, input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const expected = Number.isSafeInteger(input?.expectedRevision) ? input.expectedRevision : null
      const chatId = typeof input?.chatId === 'string' ? input.chatId : ''
      return mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        if (!writable(task, chatId, input?.actor)) return otherChat(task)
        if (expected !== null && task.revision !== expected) {
          return { value: { ok: false, code: 'stale', task } }
        }
        const patch = input?.patch !== null && typeof input?.patch === 'object' ? input.patch : input
        const refusal = transitionRefusal(task, patch)
        if (refusal !== null) return { value: { ok: false, code: refusal, task } }
        if (typeof patch.title === 'string' && patch.title.trim() === '') return { value: { ok: false, code: 'empty_title', task } }
        // The status a legacy row MEANS. A patch that names it is not a transition, so the
        // row's bytes are left alone rather than normalized by an unrelated save.
        const current = displayStatus(task.status)
        const target = patch.status === undefined ? undefined : statusOf(patch.status, current)
        const before = JSON.stringify(task)
        if (typeof patch.title === 'string' && patch.title.trim() !== '') task.title = patch.title.trim().slice(0, 200)
        if (typeof patch.objective === 'string') task.objective = patch.objective.slice(0, 4000)
        if (Array.isArray(patch.scope)) task.scope = strings(patch.scope)
        if (Array.isArray(patch.nonScope)) task.nonScope = strings(patch.nonScope)
        if (Array.isArray(patch.acceptance)) task.acceptance = acceptance(patch.acceptance, task.acceptance)
        if (target !== undefined && target !== current) task.status = target
        if (patch.priority !== undefined) task.priority = priorityOf(patch.priority)
        // Attaching a delegation to an existing task sets its role: the task was created
        // inline (or without one), and the specialist that takes it defines the specialty.
        // A task carries a role OR is inline, never both.
        if (typeof patch.role === 'string' && patch.role.trim() !== '') {
          task.role = patch.role.trim().slice(0, 80)
          delete task.inline
        }
        // The assignment the human makes in the panel: inline work (no specialist) or a role.
        // A task carries a role OR is inline, never both.
        if (patch.inline === true) {
          task.inline = true
          delete task.role
          delete task.preset
        } else if (patch.inline === false) {
          delete task.inline
        }
        if (typeof patch.preset === 'string' && patch.preset.trim() !== '') task.preset = patch.preset.trim().slice(0, 80)
        if (typeof patch.reason === 'string') {
          if (patch.reason.trim() === '') delete task.reason
          else task.reason = patch.reason.trim().slice(0, 1000)
        }
        // The reason describes why the task is blocked; leaving blocked clears it, and the
        // timeline keeps what it said.
        if (target !== undefined && target !== 'blocked' && current === 'blocked') delete task.reason
        if (patch.owner === null) delete task.owner
        else if (patch.owner !== undefined && typeof patch.owner === 'object') {
          task.owner = {
            kind: patch.owner.kind === 'human' ? 'human' : 'agent',
            label: typeof patch.owner.label === 'string' && patch.owner.label !== '' ? patch.owner.label.slice(0, 200) : 'agent',
            ...(typeof patch.owner.sessionId === 'string' ? { sessionId: patch.owner.sessionId } : {}),
          }
        }
        if (patch.result !== undefined) {
          const result = resultOf(patch.result, task.result)
          if (result === undefined) delete task.result
          else task.result = result
        }
        if (Array.isArray(patch.dependsOn)) task.dependsOn = strings(patch.dependsOn)
        if (JSON.stringify(task) === before) return { value: { ok: true, task } }
        task.revision += 1
        task.updatedAt = now()
        timeline(task, 'edited', input?.actor === 'human' ? 'human' : 'orchestrator', 'Task edited', {}, timelineLimit)
        return { changed: true, value: { ok: true, task } }
      })
    },
    /** Append a note without changing the structured fields. */
    note(cwd, input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const text = typeof input?.text === 'string' ? input.text.trim() : ''
      const chatId = typeof input?.chatId === 'string' ? input.chatId : ''
      if (text === '') return { ok: false, code: 'empty' }
      return mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        if (!writable(task, chatId, input?.actor)) return otherChat(task)
        task.revision += 1
        task.updatedAt = now()
        timeline(task, 'note', input?.actor === 'human' ? 'human' : 'orchestrator', text.slice(0, 1000), {}, timelineLimit)
        return { changed: true, value: { ok: true, task } }
      })
    },
    /** Link one child session and move the task active. */
    linkChild(cwd, input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const childId = typeof input?.sessionId === 'string' ? input.sessionId : ''
      const chatId = typeof input?.chatId === 'string' ? input.chatId : ''
      if (childId === '') return { ok: false, code: 'empty' }
      return mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        if (!writable(task, chatId, input?.actor)) return otherChat(task)
        if (!task.childSessionIds.includes(childId)) task.childSessionIds.push(childId)
        const agent = (board.agents ?? []).find((entry) => entry.sessionId === childId)
        const label = typeof input?.label === 'string' && input.label !== '' ? input.label.slice(0, 200) : (agent?.label ?? 'child')
        const role = typeof input?.role === 'string' && input.role !== '' ? input.role.slice(0, 200) : (agent?.role ?? label)
        // A linked child IS the assignment. A task created inline stops being inline when a
        // specialist takes it: a task carries a role or is inline, never both.
        if (task.inline === true) delete task.inline
        if (typeof task.role !== 'string' || task.role === '') task.role = role.slice(0, 80)
        if (typeof task.preset !== 'string' && typeof agent?.preset === 'string' && agent.preset !== '') task.preset = agent.preset
        const children = Array.isArray(task.children) ? task.children : []
        const existing = children.find((child) => child.sessionId === childId)
        if (existing === undefined) children.push({ sessionId: childId, label, role, status: 'active', startedAt: now(), endedAt: null })
        else Object.assign(existing, { label, role, status: 'active', endedAt: null })
        task.children = children
        task.owner = { kind: 'agent', label, sessionId: childId }
        if (!['done', 'cancelled', 'paused'].includes(displayStatus(task.status))) task.status = 'active'
        task.revision += 1
        task.updatedAt = now()
        timeline(task, 'child_started', 'child', `Delegated to ${label}`, { sessionId: childId }, timelineLimit)
        const links = childLinks.get(childId) ?? []
        if (!links.some((entry) => entry.cwd === cwd && entry.id === id)) links.push({ cwd, id })
        childLinks.set(childId, links)
        writeLinks(childLinks)
        return { changed: true, value: { ok: true, task } }
      })
    },
    /** A linked child settled: move to review, never straight to done. */
    childEnded(childId, info) {
      const links = childLinks.get(childId) ?? []
      if (links.length === 0) return undefined
      childLinks.delete(childId)
      writeLinks(childLinks)
      let last
      for (const link of links) {
        const result = mutate(link.cwd, (board) => {
          const task = board.tasks.find((entry) => entry.id === link.id)
          if (task === undefined) return { value: undefined }
          const children = Array.isArray(task.children) ? task.children : []
          const child = children.find((entry) => entry.sessionId === childId)
          if (child === undefined) children.push({ sessionId: childId, label: task.owner?.label ?? 'child', role: task.owner?.label ?? 'child', status: 'sleeping', startedAt: now(), endedAt: now(), stopReason: info?.stopReason ?? null })
          else Object.assign(child, { status: 'sleeping', endedAt: now(), stopReason: info?.stopReason ?? null })
          task.children = children
          const stillRunning = children.some((entry) => entry.status === 'active' || entry.status === 'paused')
          // A child settling is the runtime reporting work finished, not the human claiming
          // acceptance: the task waits in review for the orchestrator (done is close-only).
          // A child that ended in ERROR did not finish its work, so review would be a lie that
          // the orchestrator reads as "ready to accept" - measured in ~/tasks/autolabel_pipeline
          // (2026-11-11): RESEARCH child d864c24f stopped with `error` at 32 s and the task was
          // reported finished. Failure parks the task in `blocked`, which is the state that
          // says somebody must decide, and the stop reason is the reason on the row.
          const nowStatus = displayStatus(task.status)
          const failed = FAILED_STOP_REASONS.includes(String(info?.stopReason ?? '').toLowerCase())
          task.status = ['cancelled', 'paused', 'done'].includes(nowStatus)
            ? task.status
            : stillRunning
              ? 'active'
              : failed
                ? 'blocked'
                : 'review'
          if (!stillRunning && failed && nowStatus !== 'blocked') {
            task.reason = `child ${childId} ended with ${String(info?.stopReason ?? 'error')}`
          }
          const agent = (board.agents ?? []).find((entry) => entry.sessionId === childId)
          if (agent !== undefined) {
            agent.status = 'sleeping'
            agent.updatedAt = now()
          }
          task.revision += 1
          task.updatedAt = now()
          const output = Array.isArray(info?.lastAssistantMessage)
            ? info.lastAssistantMessage.filter((block) => block?.type === 'text').map((block) => block.text).join(' ').slice(0, 800)
            : ''
          timeline(task, failed && !stillRunning ? 'child_failed' : 'child_finished', 'child', `${failed && !stillRunning ? 'Child failed' : 'Child settled'} (${info?.stopReason ?? 'unknown'})${output === '' ? '' : `: ${output}`}`, { sessionId: childId }, timelineLimit)
          return { changed: true, value: { ok: true, task } }
        })
        if (result !== undefined) last = result
      }
      return last
    },
    /**
     * Settle `active` rows the ledger can prove have no running child.
     *
     * Board-level by design: it is not a transition of one task, so it takes no revision and
     * never writes a task whose children are still running (see reconcileTasks). `changed`
     * comes from the result, because the helper bumps the per-task revision, not the board's.
     */
    reconcile(cwd) {
      return mutate(cwd, (board) => {
        const result = reconcileTasks(board, timelineLimit)
        return { changed: result.fixed > 0, value: { ok: true, ...result } }
      })
    },
    /** Pause a task and interrupt its linked children; fail closed on interrupt errors. */
    pause(cwd, input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const requestedParent = typeof input?.parentSessionId === 'string' && input.parentSessionId !== '' ? input.parentSessionId : ''
      const chatId = typeof input?.chatId === 'string' ? input.chatId : ''
      return mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        if (!writable(task, chatId, input?.actor)) return otherChat(task)
        if (['done', 'cancelled'].includes(displayStatus(task.status))) return { value: { ok: false, code: 'closed', task } }
        const { interrupted, errors } = interruptChildren(task, requestedParent)
        if (errors.length > 0) return { value: { ok: false, code: 'interrupt_failed', task, interrupted, errors } }
        markChildren(board, task, 'paused', 'paused')
        task.status = 'paused'
        task.revision += 1
        task.updatedAt = now()
        timeline(task, 'paused', input?.actor === 'human' ? 'human' : 'orchestrator', `Paused${interrupted.length === 0 ? '' : `; interrupted ${interrupted.length} child session(s)`}`, { sessionIds: interrupted }, timelineLimit)
        return { changed: true, value: { ok: true, task, interrupted, errors } }
      })
    },
    /** Resume tracking a paused task. Child sessions are not auto-prompted. */
    resume(cwd, input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const chatId = typeof input?.chatId === 'string' ? input.chatId : ''
      return mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        if (!writable(task, chatId, input?.actor)) return otherChat(task)
        if (displayStatus(task.status) !== 'paused') return { value: { ok: false, code: 'not_paused', task } }
        task.status = 'active'
        const children = Array.isArray(task.children) ? task.children : []
        for (const child of children) if (child.status === 'paused') child.status = 'sleeping'
        for (const agent of board.agents ?? []) if (agent.status === 'paused') agent.status = 'sleeping'
        task.children = children
        task.revision += 1
        task.updatedAt = now()
        timeline(task, 'resumed', input?.actor === 'human' ? 'human' : 'orchestrator', 'Resumed; linked children must be reopened to continue their turn', {}, timelineLimit)
        return { changed: true, value: { ok: true, task } }
      })
    },
    /**
     * Cancel a task and interrupt its linked children; fail closed.
     *
     * WHY THIS IS A LIFECYCLE ACTION AND NOT A TRANSITION. `update` refuses a move out of
     * `paused` (use_resume) and a cancel of a task that still has children (use_close), so
     * before this method existed a paused task and a child-bearing task could never be
     * abandoned - the table had no door for them. Cancelling MEANS interrupting the children,
     * exactly as pausing does, so the interrupt lives here and the transition table keeps
     * refusing a bare edit into `cancelled`.
     *
     * @returns `{ok, task, interrupted, errors, note}`; a refused interrupt cancels nothing.
     */
    cancel(cwd, input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const reason = typeof input?.reason === 'string' ? input.reason.trim().slice(0, 1000) : ''
      return mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        const outcome = cancelOne(board, task, input, reason)
        if (outcome.ok === false) return { value: outcome }
        return {
          changed: outcome.changed === true,
          value: { ok: true, task: outcome.task, interrupted: outcome.interrupted, errors: outcome.errors, note: outcome.note },
        }
      })
    },
    /**
     * Cancel a batch of tasks in one ledger write, interrupting every linked child first.
     *
     * The batch is partial by design: one task that refuses (wrong chat, terminal, a child that
     * will not stop) is reported in its own row and leaves the other rows' cancellations in
     * place. The caller reads the per-task results; a whole batch is never reported as done
     * when one row was refused.
     */
    cancelMany(cwd, input) {
      const ids = batchIds(input)
      if (ids.length === 0) return { ok: false, code: 'invalid', message: 'pass id or ids' }
      if (ids.length > MAX_BATCH) return { ok: false, code: 'batch_too_large', max: MAX_BATCH }
      const reason = typeof input?.reason === 'string' ? input.reason.trim().slice(0, 1000) : ''
      return mutate(cwd, (board) => {
        const items = []
        let changed = false
        for (const id of ids) {
          const task = board.tasks.find((entry) => entry.id === id)
          if (task === undefined) { items.push({ id, ok: false, code: 'not_found' }); continue }
          const outcome = cancelOne(board, task, input, reason)
          if (outcome.ok === false) {
            items.push({ id, ok: false, code: outcome.code, status: outcome.task?.status, revision: outcome.task?.revision, interrupted: outcome.interrupted, errors: outcome.errors })
            continue
          }
          if (outcome.changed === true) changed = true
          items.push({ id, ok: true, status: outcome.task.status, revision: outcome.task.revision, interrupted: outcome.interrupted, errors: outcome.errors, note: outcome.note })
        }
        const failed = items.filter((entry) => entry.ok === false).length
        return { changed, value: { ok: failed === 0, requested: ids.length, cancelled: items.length - failed, failed, results: items } }
      })
    },
    /** Close a task as done and interrupt its linked children; fail closed. */
    close(cwd, input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      return mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        const outcome = closeOne(board, task, input, input?.result)
        if (outcome.ok === false) return { value: outcome }
        return {
          changed: outcome.changed === true,
          value: {
            ok: true,
            task: outcome.task,
            interrupted: outcome.interrupted,
            errors: outcome.errors,
            ...(outcome.note === undefined ? {} : { note: outcome.note }),
            ...(outcome.resultRecorded === true ? { resultRecorded: true } : {}),
          },
        }
      })
    },
    /**
     * Accept a batch of review tasks in one ledger write, filling missing results from the
     * supplied shared or per-task result.
     *
     * The batch is partial by design: a row still missing a summary/evidence, a row that is not
     * in review, or a row whose child will not stop is reported in its own entry and leaves the
     * other rows' acceptances in place. It is never reported as a whole-batch success when one
     * row was refused.
     */
    closeMany(cwd, input) {
      const ids = batchIds(input)
      if (ids.length === 0) return { ok: false, code: 'invalid', message: 'pass id or ids' }
      if (ids.length > MAX_BATCH) return { ok: false, code: 'batch_too_large', max: MAX_BATCH }
      const perTask = perTaskResults(input)
      return mutate(cwd, (board) => {
        const items = []
        let changed = false
        for (const id of ids) {
          const task = board.tasks.find((entry) => entry.id === id)
          if (task === undefined) { items.push({ id, ok: false, code: 'not_found' }); continue }
          const outcome = closeOne(board, task, input, perTask.has(id) ? perTask.get(id) : input?.result)
          if (outcome.ok === false) {
            items.push({ id, ok: false, code: outcome.code, status: outcome.task?.status, revision: outcome.task?.revision, interrupted: outcome.interrupted, errors: outcome.errors })
            continue
          }
          if (outcome.changed === true) changed = true
          items.push({
            id,
            ok: true,
            status: outcome.task.status,
            revision: outcome.task.revision,
            interrupted: outcome.interrupted,
            errors: outcome.errors,
            ...(outcome.note === undefined ? {} : { note: outcome.note }),
            ...(outcome.resultRecorded === true ? { resultRecorded: true } : {}),
          })
        }
        const failed = items.filter((entry) => entry.ok === false).length
        return { changed, value: { ok: failed === 0, requested: ids.length, closed: items.length - failed, failed, results: items } }
      })
    },
    /**
     * Force-stop linked children without changing a task's lifecycle.
     *
     * This is the explicit stop primitive the orchestrator and the human panel both use: it
     * takes a task id (all its linked children) or one session id, interrupts each through the
     * subagent runtime, records why on every task that links one of them, and leaves the task
     * status to the runtime's settle event. A child that has already settled is an accepted
     * no-op at the runtime; a child the caller does not own is reported in errors.
     */
    stop(cwd, input) {
      const taskId = typeof input?.id === 'string' ? input.id : ''
      const sessionId = typeof input?.sessionId === 'string' ? input.sessionId : ''
      const chatId = typeof input?.chatId === 'string' ? input.chatId : ''
      const reason = typeof input?.reason === 'string' ? input.reason.trim().slice(0, 1000) : ''
      if (taskId === '' && sessionId === '') return { ok: false, code: 'invalid', message: 'pass id or sessionId' }
      const board = readBoard(pathFor(cwd))
      const tasks = []
      const targets = []
      const addTarget = (id) => {
        if (typeof id === 'string' && id !== '' && !targets.includes(id)) targets.push(id)
      }
      if (taskId !== '') {
        const task = board.tasks.find((entry) => entry.id === taskId)
        if (task === undefined) return { ok: false, code: 'not_found' }
        if (!writable(task, chatId, input?.actor)) return { ok: false, code: 'other_chat', chatId: chatOf(task) }
        tasks.push(task)
        for (const childId of Array.isArray(task.childSessionIds) ? task.childSessionIds : []) addTarget(childId)
      }
      if (sessionId !== '') {
        addTarget(sessionId)
        for (const task of board.tasks) {
          // A sessionId-only stop still must not write another chat's timeline. The runtime's
          // ancestor check is the authority for the stop itself; the ledger write is scoped.
          if (!writable(task, chatId, input?.actor)) continue
          if (Array.isArray(task.childSessionIds) && task.childSessionIds.includes(sessionId) && !tasks.includes(task)) tasks.push(task)
        }
      }
      if (targets.length === 0) return { ok: false, code: 'no_child', task: tasks[0] }
      const parentFor = new Map()
      for (const task of tasks) {
        const parent = typeof task.parentSessionId === 'string' && task.parentSessionId !== ''
          ? task.parentSessionId
          : (typeof input?.parentSessionId === 'string' ? input.parentSessionId : '')
        for (const childId of Array.isArray(task.childSessionIds) ? task.childSessionIds : []) {
          if (targets.includes(childId) && !parentFor.has(childId)) parentFor.set(childId, parent)
        }
      }
      const stopped = []
      const errors = []
      for (const childId of targets) {
        const parent = parentFor.get(childId) || (typeof input?.parentSessionId === 'string' ? input.parentSessionId : '')
        if (typeof hooks.interrupt !== 'function') { errors.push(childId + ': subagent service is unavailable'); continue }
        try {
          hooks.interrupt(childId, parent)
          stopped.push(childId)
        } catch (error) {
          errors.push(childId + ': ' + (error instanceof Error ? error.message : String(error)))
        }
      }
      if (tasks.length > 0) {
        mutate(cwd, (current) => {
          let changed = false
          for (const task of tasks) {
            const row = current.tasks.find((entry) => entry.id === task.id)
            if (row === undefined) continue
            row.revision += 1
            row.updatedAt = now()
            const text = 'Stop requested for ' + (stopped.length > 0 ? stopped.join(', ') : 'no live child')
              + (reason === '' ? '' : ': ' + reason)
              + (errors.length === 0 ? '' : '; errors: ' + errors.join('; '))
            timeline(row, 'stop_requested', input?.actor === 'human' ? 'human' : 'orchestrator', text, { sessionIds: stopped }, timelineLimit)
            changed = true
          }
          return { changed, value: { ok: true } }
        })
      }
      return { ok: errors.length === 0, stopped, errors, ...(errors.length === 0 ? {} : { code: 'interrupt_failed' }) }
    },
    /** Remove a task from the ledger; linked child sessions keep running. */
    remove(cwd, input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const chatId = typeof input?.chatId === 'string' ? input.chatId : ''
      return mutate(cwd, (board) => {
        const index = board.tasks.findIndex((entry) => entry.id === id)
        if (index === -1) return { value: { ok: false, code: 'not_found' } }
        if (!writable(board.tasks[index], chatId, input?.actor)) return otherChat(board.tasks[index])
        const [task] = board.tasks.splice(index, 1)
        for (const childId of task.childSessionIds ?? []) {
          const links = (childLinks.get(childId) ?? []).filter((entry) => !(entry.cwd === cwd && entry.id === id))
          if (links.length === 0) childLinks.delete(childId)
          else childLinks.set(childId, links)
        }
        writeLinks(childLinks)
        // A delegation that registered its role but never linked the task leaves an agent
        // row reachable only through lastTaskId - measured 2026-10-30: such a row stayed
        // `active` for four days after its chat died and counted as a running subagent.
        for (const agent of board.agents ?? []) {
          if (agent.lastTaskId !== id) continue
          agent.status = 'sleeping'
          agent.lastTaskId = null
          agent.updatedAt = now()
        }
        return { changed: true, value: { ok: true, removed: true, id, task } }
      })
    },
    /**
     * The one operation shape the UI command uses. `actorSessionId` is the chat the
     * command ran in; it is resolved to the chat id here so every write from the panel
     * is attributed and guarded the same way a tool call is.
     */
    applyOp(cwd, op, actor = 'human', actorSessionId = '') {
      if (op === null || typeof op !== 'object') return { ok: false, code: 'invalid' }
      const kind = op.op
      const chatId = typeof hooks.rootOf === 'function' ? hooks.rootOf(actorSessionId) : actorSessionId
      if (kind === 'create') {
        const created = this.create(cwd, { ...(op.task ?? op), parentSessionId: actorSessionId, chatId }, actor)
        return created?.ok === false ? created : { ok: true, task: created }
      }
      // EVERY COMMAND-PATH WRITE IS A COMPARE-AND-SET. The panel reads a task, edits it and
      // writes it back; without the revision it read, a concurrent edit (another panel, a
      // child settling, the orchestrator) is silently overwritten. A model tool has the
      // revision in its schema; the command has only what the client sends, so the check is
      // here - once, for every mutation - since this is the human/client path.
      if (MUTATING_OPS.includes(kind)) {
        if (!Number.isSafeInteger(op.expectedRevision)) return { ok: false, code: 'needs_revision' }
        const current = this.get(cwd, op.id)
        if (current === undefined) return { ok: false, code: 'not_found' }
        if (current.revision !== op.expectedRevision) return { ok: false, code: 'stale', task: current }
      }
      if (kind === 'update') return this.update(cwd, { ...op, chatId, actor })
      if (kind === 'note') return this.note(cwd, { ...op, chatId, actor })
      if (kind === 'link') return this.linkChild(cwd, { ...op, chatId, actor })
      if (kind === 'pause') return this.pause(cwd, { ...op, chatId, parentSessionId: actorSessionId, actor })
      if (kind === 'resume') return this.resume(cwd, { ...op, chatId, actor })
      if (kind === 'close') return this.close(cwd, { ...op, chatId, parentSessionId: actorSessionId, actor })
      if (kind === 'cancel') return this.cancel(cwd, { ...op, chatId, parentSessionId: actorSessionId, actor })
      // A forced stop is a timeline action, not a status transition: it takes no revision
      // (it changes no task field) and leaves the status to the runtime's settle event.
      if (kind === 'stop') return this.stop(cwd, { ...op, chatId, parentSessionId: actorSessionId, actor })
      if (kind === 'remove') return this.remove(cwd, { ...op, chatId, actor })
      if (kind === 'get') return { ok: true, task: this.get(cwd, op.id) }
      if (kind === 'list') return { ok: true, tasks: this.list(cwd, { chatId, all: op.all === true }) }
      if (kind === 'agents') return { ok: true, agents: this.agents(cwd) }
      // Board-level, so it takes no revision: it acts only on rows whose own children are all
      // settled, and it is idempotent (a reconciled row is no longer `active`).
      if (kind === 'reconcile') return this.reconcile(cwd)
      return { ok: false, code: 'unknown_op' }
    },
    /** Register a child without a task (used by the command path). */
    trackChild(childId, cwd, id) {
      const links = childLinks.get(childId) ?? []
      if (!links.some((entry) => entry.cwd === cwd && entry.id === id)) links.push({ cwd, id })
      childLinks.set(childId, links)
      writeLinks(childLinks)
    },
  }
}

/**
 * Register the service, tools and command.
 *
 * @param ctx - Cordis context.
 * @param config - Raw plugin config.
 */
export function apply(ctx, config = {}) {
  /**
   * The chat a session belongs to: walk `parentSession` up the live agent tree, so a
   * child's tasks land on the parent chat's board - the board the human is reading.
   * The walk stops at the deepest session it can prove: a historical or unloaded parent
   * never invents a root, and depth is bounded by the harness (default 1) anyway.
   */
  const rootOf = (sessionId) => {
    if (typeof sessionId !== 'string' || sessionId === '') return ''
    let id = sessionId
    for (let hop = 0; hop < 8; hop += 1) {
      const parent = ctx.get('agents')?.get(id)?.session?.header?.parentSession
      if (typeof parent !== 'string' || parent === '') break
      id = parent
    }
    return id
  }
  const service = createService(config, ctx.logger, {
    rootOf,
    interrupt(childId, parentSessionId) {
      const subagents = ctx.get('subagents')
      if (subagents === undefined || typeof subagents.interrupt !== 'function') throw new Error('subagent service is unavailable')
      if (typeof parentSessionId !== 'string' || parentSessionId === '') throw new Error('no parent session to authorize the interrupt')
      const agents = ctx.get('agents')
      let parent = agents?.get(parentSessionId)
      // A legacy task may not know its parent, and the human panel can act from another chat.
      // The child's live session knows its direct creator, so use that exact agent when the
      // recorded address does not resolve. This is still an agent in the child's ancestry; the
      // chat check above already decided whether this caller may act on the task.
      if (parent === undefined) {
        const actualParentId = agents?.get(childId)?.session?.header?.parentSession
        if (typeof actualParentId === 'string' && actualParentId !== '') parent = agents?.get(actualParentId)
      }
      // THE RUNTIME'S AUTHORITY IS A TAGGED UNION, NOT AN AGENT OBJECT. DSH 0.2.1-rc.2
      // admits {kind:'ancestor', agent} for a live agent in the target's ancestry and
      // {kind:'user', parentSessionId} for the human/client path. Passing the Agent itself
      // made every live child UNAUTHORIZED, so cancel/pause/close always returned
      // interrupt_failed - measured by scripts/taskboard-close-stop-proof.mjs.
      subagents.interrupt(childId, parent === undefined
        ? { kind: 'user', parentSessionId }
        : { kind: 'ancestor', agent: parent })
    },
  })
  const board = ctx.provide('taskboard', service)
  ctx.effect(() => board)

  ctx.on('subagent/end', (info) => {
    try {
      service.childEnded(info?.id, info)
    } catch (error) {
      ctx.logger.warn(`taskboard: could not settle child ${info?.id}: ${error.message}`)
    }
  })

  const out = (value) => ({
    schema: { type: 'json' },
    render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }],
  })

  ctx.tools.register(defineTool({
    name: 'task_create',
    description: 'Create one workspace task with an objective, scope, non-scope and acceptance. The taskboard is the workspace ledger for work in flight: open a task for EVERY change you make, whether you do it inline or delegate it, and keep it moving through open/active/review/done. Delegation is one way to run a task, not the reason to create one. Every task carries a specialist role (with its preset) or is inline: pass role, or inline: true when you do the work yourself; a task with neither is refused with needs_role_or_inline. Returns the full task, including its id and revision.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short task title.' },
      objective: { type: 'string', description: 'The outcome in one paragraph.' },
      scope: { type: 'array', items: { type: 'string' }, description: 'What the work may touch.' },
      nonScope: { type: 'array', items: { type: 'string' }, description: 'What the work must not touch, with the reason.' },
      acceptance: { type: 'array', items: { type: 'string' }, description: 'How the orchestrator will judge the result.' },
      role: { type: 'string', description: 'Specialist role that owns the task (e.g. BACKEND, REVIEWER). Required unless inline is true.' },
      preset: { type: 'string', description: 'The role preset id the child will run with, when it is already known.' },
      inline: { type: 'boolean', description: 'true when the caller does this work itself, with no specialist role. Required unless role is given.' },
      parentId: { type: 'string', description: 'Optional parent task id.' },
      priority: { type: 'string', enum: PRIORITIES, description: 'low | normal | high.' },
    },
    output: out(),
    execute(args, exec) {
      const task = service.create(workingDir(exec.agent), { ...args, parentSessionId: exec.agent?.id, chatId: rootOf(exec.agent?.id) }, 'orchestrator')
      return Promise.resolve(task)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_get',
    description: 'Read one task in full: objective, scope, non-scope, acceptance, status, result and timeline.',
    parameters: { id: { type: 'string', required: true, description: 'Task id.' } },
    output: out(),
    execute(args, exec) {
      const task = service.get(workingDir(exec.agent), args.id)
      return Promise.resolve(task ?? { ok: false, code: 'not_found' })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_list',
    description: 'List tasks in compact form. The default scope is THIS CHAT only: every chat starts with its own empty board. Pass scope "workspace" to read every task the workspace has ever recorded, including other chats and rows from before boards were per-chat - use it when the user asks what has been done before, or before reusing a role name.',
    parameters: {
      scope: { type: 'string', enum: ['chat', 'workspace'], description: 'chat (default) lists this chat only; workspace lists the whole workspace history.' },
    },
    output: out(),
    execute(args, exec) {
      return Promise.resolve(service.list(workingDir(exec.agent), {
        chatId: rootOf(exec.agent?.id),
        all: args.scope === 'workspace',
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_update',
    description: 'Compare-and-set one task. Pass the revision you read; a stale revision is rejected with the current task. This is how a human or the orchestrator changes status, scope, non-scope, acceptance or the result summary.',
    parameters: {
      id: { type: 'string', required: true, description: 'Task id.' },
      expectedRevision: { type: 'integer', required: true, description: 'Task revision you read.' },
      status: { type: 'string', enum: EDITABLE_STATUSES, description: 'New status: open | active | review | blocked | cancelled. Use task_pause/task_resume/task_close for paused/done. open->active needs a role+owner or an inline task; ->review needs a result summary and evidence; blocked needs a reason; done and cancelled are terminal.' },
      reason: { type: 'string', description: 'Why the task is blocked. Required when moving it to blocked, and a BLANK reason on a blocked task is refused (needs_reason) - omit the field to keep the current one.' },
      title: { type: 'string', description: 'New title.' },
      objective: { type: 'string', description: 'New objective.' },
      scope: { type: 'array', items: { type: 'string' }, description: 'New scope list.' },
      nonScope: { type: 'array', items: { type: 'string' }, description: 'New non-scope list.' },
      acceptance: { type: 'array', items: { type: 'string' }, description: 'New acceptance list.' },
      resultSummary: { type: 'string', description: 'Result summary.' },
      resultEvidence: { type: 'array', items: { type: 'string' }, description: 'Commands, outputs and files that prove the result.' },
      resultArtifacts: { type: 'array', items: { type: 'string' }, description: 'Handoff or artifact paths.' },
      resultDecisions: { type: 'array', items: { type: 'string' }, description: 'Decisions worth carrying forward.' },
      resultRisks: { type: 'array', items: { type: 'string' }, description: 'Known risks or unknowns.' },
      priority: { type: 'string', enum: PRIORITIES, description: 'low | normal | high.' },
    },
    output: out(),
    execute(args, exec) {
      const patch = {}
      for (const key of ['status', 'title', 'objective', 'scope', 'nonScope', 'acceptance', 'priority', 'reason']) {
        if (args[key] !== undefined) patch[key] = args[key]
      }
      if (args.resultSummary !== undefined || args.resultEvidence !== undefined || args.resultArtifacts !== undefined || args.resultDecisions !== undefined || args.resultRisks !== undefined) {
        patch.result = {
          summary: args.resultSummary,
          evidence: args.resultEvidence,
          artifacts: args.resultArtifacts,
          decisions: args.resultDecisions,
          risks: args.resultRisks,
        }
      }
      const result = service.update(workingDir(exec.agent), { id: args.id, expectedRevision: args.expectedRevision, patch, chatId: rootOf(exec.agent?.id) })
      return Promise.resolve(result)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_note',
    description: 'Append one note to a task timeline without changing its structured fields.',
    parameters: {
      id: { type: 'string', required: true, description: 'Task id.' },
      text: { type: 'string', required: true, description: 'The note.' },
    },
    output: out(),
    execute(args, exec) {
      return Promise.resolve(service.note(workingDir(exec.agent), { ...args, chatId: rootOf(exec.agent?.id) }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_link',
    description: 'Link one child session to a task and move the task active. Use it when a delegation was started outside delegate_task.',
    parameters: {
      id: { type: 'string', required: true, description: 'Task id.' },
      sessionId: { type: 'string', required: true, description: 'Child session id.' },
      label: { type: 'string', description: 'Child label.' },
      role: { type: 'string', description: 'Short human-readable role for the child.' },
    },
    output: out(),
    execute(args, exec) {
      return Promise.resolve(service.linkChild(workingDir(exec.agent), { ...args, chatId: rootOf(exec.agent?.id) }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_pause',
    description: 'Pause a task and interrupt its linked child sessions. The task moves to paused; the return lists the interrupted children and any errors. A child that has already settled is an accepted no-op.',
    parameters: { id: { type: 'string', required: true, description: 'Task id.' } },
    output: out(),
    execute(args, exec) {
      return Promise.resolve(service.pause(workingDir(exec.agent), { id: args.id, parentSessionId: exec.agent?.id, chatId: rootOf(exec.agent?.id), actor: 'orchestrator' }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_resume',
    description: 'Move a paused task back to active. It does not auto-prompt the child; open the child session to continue the interrupted turn.',
    parameters: { id: { type: 'string', required: true, description: 'Task id.' } },
    output: out(),
    execute(args, exec) {
      return Promise.resolve(service.resume(workingDir(exec.agent), { id: args.id, chatId: rootOf(exec.agent?.id), actor: 'orchestrator' }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_cancel',
    description: 'Cancel one task or a batch (ids) and interrupt every linked child first. Use it for work that will not be finished: a paused task and a task that still has children can ONLY be abandoned this way (an ordinary update is refused). The reason is recorded as a decision on every result and as a timeline entry. A refused child stop cancels nothing and returns interrupt_failed; a batch reports each row separately and never claims a whole-batch success when one row was refused. done is terminal: an accepted task stays accepted.',
    parameters: {
      id: { type: 'string', description: 'Task id for a single cancel.' },
      ids: { type: 'array', items: { type: 'string' }, description: 'Task ids for a batch cancel: one ledger write, per-task results, partial by design.' },
      reason: { type: 'string', description: 'Why the work is being dropped, in one line. Shared by a batch and kept on every result and timeline.' },
    },
    output: out(),
    execute(args, exec) {
      const base = { parentSessionId: exec.agent?.id, chatId: rootOf(exec.agent?.id), actor: 'orchestrator' }
      if (Array.isArray(args.ids)) {
        return Promise.resolve(service.cancelMany(workingDir(exec.agent), { ...base, ids: args.ids, reason: args.reason }))
      }
      if (typeof args.id !== 'string' || args.id === '') return Promise.resolve({ ok: false, code: 'invalid', message: 'pass id or ids' })
      return Promise.resolve(service.cancel(workingDir(exec.agent), { ...base, id: args.id, reason: args.reason }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_close',
    description: 'Close one task or a batch (ids) as done. The result can arrive in the same call: resultSummary and at least one resultEvidence fill only fields that are missing, so a summary already recorded is never rewritten. A task that is not in review is refused (needs_review); a close with no summary or evidence is refused (needs_result/needs_evidence); a batch returns per-task results and never claims a whole-batch success when one row was refused.',
    parameters: {
      id: { type: 'string', description: 'Task id for a single close.' },
      ids: { type: 'array', items: { type: 'string' }, description: 'Task ids for a batch close: one ledger write, per-task results, partial by design.' },
      resultSummary: { type: 'string', description: 'What was achieved. Used only where the task has no summary yet; an existing summary is never rewritten.' },
      resultEvidence: { type: 'array', items: { type: 'string' }, description: 'At least one command, output, file or observation proving the result. Used only where the task has no evidence yet.' },
      resultArtifacts: { type: 'array', items: { type: 'string' }, description: 'Handoff or artifact paths.' },
      resultDecisions: { type: 'array', items: { type: 'string' }, description: 'Decisions worth carrying forward.' },
      resultRisks: { type: 'array', items: { type: 'string' }, description: 'Known risks or unknowns.' },
      results: {
        type: 'array',
        description: 'Per-task results for a batch. Each entry overrides the shared result fields for that task id.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: 'Task id this result belongs to.' },
            summary: { type: 'string', description: 'What was achieved for this task.' },
            evidence: { type: 'array', items: { type: 'string' }, description: 'Evidence for this task.' },
            artifacts: { type: 'array', items: { type: 'string' }, description: 'Artifact paths for this task.' },
            decisions: { type: 'array', items: { type: 'string' }, description: 'Decisions for this task.' },
            risks: { type: 'array', items: { type: 'string' }, description: 'Risks for this task.' },
          },
        },
      },
    },
    output: out(),
    execute(args, exec) {
      const result = {}
      for (const key of ['summary', 'evidence', 'artifacts', 'decisions', 'risks']) {
        const source = 'result' + key.slice(0, 1).toUpperCase() + key.slice(1)
        if (args[source] !== undefined) result[key] = args[source]
      }
      const input = {
        parentSessionId: exec.agent?.id,
        chatId: rootOf(exec.agent?.id),
        actor: 'orchestrator',
        ...(Object.keys(result).length === 0 ? {} : { result }),
        ...(Array.isArray(args.results) ? { results: args.results } : {}),
      }
      if (Array.isArray(args.ids)) return Promise.resolve(service.closeMany(workingDir(exec.agent), { ...input, ids: args.ids }))
      if (typeof args.id !== 'string' || args.id === '') return Promise.resolve({ ok: false, code: 'invalid', message: 'pass id or ids' })
      const single = Array.isArray(args.results) ? args.results.find((entry) => entry?.id === args.id) : undefined
      const singleResult = single === undefined ? (Object.keys(result).length === 0 ? undefined : result) : single
      return Promise.resolve(service.close(workingDir(exec.agent), { ...input, id: args.id, ...(singleResult === undefined ? {} : { result: singleResult }) }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_stop',
    description: 'Force-stop a linked child session without changing the task status: pass id for every child linked to a task, or sessionId for one child. The child is interrupted through the subagent runtime (the same service the human panel uses); the reason goes on the timeline, and the task status is left to the runtime settle event. Use task_cancel/task_pause/task_close when the task itself should change state.',
    parameters: {
      id: { type: 'string', description: 'Task id whose linked children should stop.' },
      sessionId: { type: 'string', description: 'One child session id to stop.' },
      reason: { type: 'string', description: 'Why the stop is requested; recorded on every task that links the child.' },
    },
    output: out(),
    execute(args, exec) {
      return Promise.resolve(service.stop(workingDir(exec.agent), { ...args, parentSessionId: exec.agent?.id, chatId: rootOf(exec.agent?.id), actor: 'orchestrator' }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_remove',
    description: 'Remove a task from the workspace ledger. The task and its timeline are deleted; linked child sessions are deliberately left running, so pause or close first if they should stop.',
    parameters: { id: { type: 'string', required: true, description: 'Task id.' } },
    output: out(),
    execute(args, exec) {
      return Promise.resolve(service.remove(workingDir(exec.agent), { id: args.id, chatId: rootOf(exec.agent?.id) }))
    },
  }))

  ctx.commands.register({
    name: 'taskboard',
    description: 'Apply one JSON operation to the workspace task ledger (used by the Tasks panel).',
    recordInput: false,
    handler: (invocation) => {
      let op
      try {
        op = JSON.parse(invocation.rawInput)
      } catch {
        return { kind: 'error', text: 'taskboard: expected a JSON operation' }
      }
      try {
        const result = service.applyOp(workingDir(invocation.agent), op, 'human', invocation.agent?.id)
        if (result?.ok === false) {
          const details = []
          if (result.code) details.push(result.code)
          // A refusal may carry one readable sentence for the human (the panel shows this
          // text verbatim); the code alone does not say what to do about a full board.
          if (typeof result.message === 'string' && result.message !== '') details.push(result.message)
          if (result.task?.revision !== undefined) details.push(`current rev ${result.task.revision}`)
          if (Array.isArray(result.errors)) details.push(...result.errors)
          return { kind: 'error', text: `taskboard: ${details.join('; ')}` }
        }
        return { kind: 'success', text: JSON.stringify(result) }
      } catch (error) {
        return { kind: 'error', text: `taskboard: ${error.message}` }
      }
    },
  })
}

export { createService, readBoard, writeBoard }
