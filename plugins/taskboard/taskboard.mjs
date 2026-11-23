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
 *              `0` is UNLIMITED (explicitly: no work-in-flight cap at all); a negative,
 *              a string or a missing value keeps the 200 default.
 *     maxRows  hard row limit for the ledger file itself. NO DEFAULT: without this key the
 *              board has no row limit. A positive integer is a limit (a create past it is
 *              refused with `board_rows_full`), `0` is the explicit spelling of no limit, and
 *              nothing is ever evicted. A limit that fires without the owner asking for it
 *              stopped a real workspace at 1000 rows, which is why the default is "none".
 *     timelineLimit maximum timeline entries per task. Default 120.
 *     staleAfterMs  how old an untouched role row must be to report `stale`.
 *                   Default 86400000 (one day).
 *     lockWaitMs    how long a writer waits for another process's board lock before it
 *                   refuses by name. Default 10000.
 *     lockStaleMs   age at which a lock left by a dead process is taken over. Default 30000.
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
 *   - Every read-modify-write holds a directory lock next to the file (<file>.lock, created
 *     with mkdir, which is O_EXCL on the filesystem). A second process WAITS for the lock
 *     instead of overwriting the first process's rows; a lock left by a killed process is
 *     taken over once it is older than lockStaleMs.
 *   - A stale `expectedRevision` returns `stale` with the current task; it never
 *     overwrites the newer value.
 *   - A child start/end with no linked task is ignored; the orchestrator can link
 *     it later with `task_link`.
 *   - Writes are serialized inside one process by the synchronous mutate() and across
 *     processes by the file lock; the file stays the authority for both.
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
 *     knowing the id is the reason to look. A ROOT agent may widen a note or an edit to
 *     another chat's task on purpose with `scope: 'workspace'` - one ledger per workspace,
 *     a chat board is a view of it - and the timeline records which chat the write came
 *     from. A child session cannot widen.
 *   - ONE CHILD SERVES ONE TASK. `linkChild` transfers the lease: every other task loses
 *     the id, its child row becomes `moved`, and the transfer is on that task's timeline.
 *     The role row keeps `currentTaskId`; `interruptChildren` stops a child only when THIS
 *     task holds its lease and reports the ones it left alone as `skipped`. Measured
 *     2026-11-12: two tasks listed one child, and closing the first stopped the work the
 *     second had been given.
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
 *   - THE OWNER'S DOOR IS THE COMMAND ONLY. `op: "owner-status"` writes any status without
 *     `transitionRefusal` (the owner's own decision, asked for on 2026-11-19), stops the
 *     children of a terminal or held target, writes a `status` timeline entry with actor
 *     `human` and a `waiver` journal event with code `owner_status_override` carrying
 *     from/to/reason/boardId/taskId. No model tool exposes it: an agent stays under the
 *     lifecycle, and the human is the only caller that can mint an acceptance.
 *   - THE BOARD HAS NO ROW LIMIT UNLESS THE WORKSPACE ASKS. `maxRows` has no default; the
 *     shipped 1000-row guard refused new work on a real 1000-row board, and a limit that
 *     fires without the owner's decision is the defect, not the safety. Nothing is evicted.
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
import { mirrorTask, registerStatus } from './mirror.mjs'
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import { appendRowEvent, checkRow as checkJournalRow } from './lib/journal.mjs'
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

/**
 * Why the case gate refused one acceptance case, in the words the closer reads.
 *
 * The case library returns stable codes; a close that printed `SELF_RUN` would send the reader to
 * another file to find out what happened. The raw code stays on the blocker for the tools.
 */
const CASE_GATE_REASON = {
  CASE_MISSING: 'the task links to a case that is not in the library any more',
  CASE_FOREIGN: 'it belongs to another task',
  CASE_UNLINKED: 'it names no task of its own',
  CASE_NOT_ACCEPTANCE: 'it is not an automated acceptance case',
  DEGRADED: 'its test file is gone, so the case was degraded to documented-only',
  RUN_ARTIFACT_MISSING: 'the run it was verified by left no artifact',
  RUN_MISMATCH: 'the run artifact does not match the recorded run',
  TEST_CHANGED: 'its test file changed after the verification',
  STALE: 'it is stale: a surface file changed after the verification',
  SELF_AUTHORED: 'the implementer authored it',
  SELF_RUN: 'the implementer ran it',
  NOT_MEASURED: 'confirmed manually, not measured by a run',
  UNKNOWN_PRESET: 'its author or run is not a known preset',
  IMPLEMENTER_UNKNOWN: 'the implementer preset is unknown, so independence cannot be shown',
  LEGACY_NO_AUTHOR: 'it records no author',
  LEGACY_NO_RUN_BY: 'it records no preset for the run that verified it',
  SURFACE_FILES_MISSING: 'it names no surface files, so a changed surface cannot be noticed',
  TEST_HASH_MISSING: 'it records no hash of its test file',
  NOT_VERIFIED: 'its status is not verified',
}

/** One refusal line: which case, which fact. */
function describeBlocker(entry) {
  const id = typeof entry?.id === 'string' && entry.id !== '' ? entry.id : 'unknown case'
  const status = typeof entry?.status === 'string' && entry.status !== ''
    ? entry.status
    : (entry?.reason === 'CASE_MISSING' ? 'missing' : 'unknown status')
  const reason = CASE_GATE_REASON[entry?.reason] ?? 'its provenance does not support acceptance'
  return `${id} (${status}: ${reason})`
}

/**
 * The case ids a task row owns.
 *
 * WHY THE ROW CARRIES THEM. The case library is a directory of files: a deleted file is
 * indistinguishable from a task that never had a case, so the LINK has to live somewhere that
 * outlives the deletion. It lives on the task row. Ids are de-duplicated and bounded: this is a
 * reference list, not a payload.
 */
function caseIdsOf(value) {
  if (!Array.isArray(value)) return []
  const list = value
    .map((entry) => (typeof entry === 'string' ? entry.trim().slice(0, 120) : ''))
    .filter((entry) => entry !== '')
  return [...new Set(list)].slice(0, 50)
}

/**
 * The verification level a task declares (P2, the proportional standard).
 *
 * `proof` - run the product and quote it (L0, a local edit). `case` - the same, plus one case when
 * the behaviour is worth pinning (L1, a contained feature). `independent` - another preset wrote
 * and ran the acceptance case against a wrong-product red (L2, or any risk trigger). A row written
 * before the level existed has none, and keeps the pre-P2 behaviour: the case gate decides.
 */
export const VERIFICATION_LEVELS = ['proof', 'case', 'independent']

/** A declared level, or '' for a row that predates the field. */
function verificationOf(value) {
  return typeof value === 'string' && VERIFICATION_LEVELS.includes(value.trim()) ? value.trim() : ''
}

/**
 * Acceptance criteria with STABLE ids.
 *
 * The id is what a case names (`criterionId`) and what the close counts, so it must survive an
 * edit of its text: a bare string gets `AC-<n>` by position, an object keeps the id it was given.
 * Duplicates are dropped - two criteria with one id cannot be counted twice.
 */
function criteriaOf(value) {
  const entries = Array.isArray(value) ? value : []
  const seen = new Set()
  const list = []
  for (const entry of entries) {
    let id = ''
    let text = ''
    if (typeof entry === 'string') text = entry.trim()
    else if (entry !== null && typeof entry === 'object') {
      id = typeof entry.id === 'string' ? entry.id.trim() : ''
      text = typeof entry.text === 'string' ? entry.text.trim() : ''
    }
    if (text === '') continue
    if (id === '') id = `AC-${list.length + 1}`
    if (seen.has(id)) continue
    seen.add(id)
    list.push({ id: id.slice(0, 40), text: text.slice(0, 500) })
    if (list.length >= 40) break
  }
  return list
}

/**
 * The ids a REVIEW task reviews in one pass (P2.1 batch review), or null when the value is not a
 * usable batch.
 *
 * WHY IT IS A FIELD AND NOT A LINK LIST. One REVIEWER child judges SEVERAL tasks and returns a
 * verdict per task; the row has to name them, or the brief and the close cannot tell which tasks
 * one review covered. The batch is 2-8: one task is a normal review (delegate_task), more than
 * eight is a queue that hides a task instead of reviewing it.
 */
export const REVIEW_BATCH_MIN = 2
export const REVIEW_BATCH_MAX = 8

function reviewedTaskIdsOf(value) {
  if (!Array.isArray(value)) return null
  const ids = [...new Set(value.filter((entry) => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim()))].slice(0, REVIEW_BATCH_MAX + 1)
  return ids
}

/** Why a batch is unusable, or null. `board` and `self` are checked by the caller that can see them. */
function batchRefusal(ids, selfId) {
  if (ids === null || ids.length === 0) return null
  if (ids.length < REVIEW_BATCH_MIN) return 'review_batch_too_small'
  if (ids.length > REVIEW_BATCH_MAX) return 'review_batch_too_large'
  if (selfId !== undefined && ids.includes(selfId)) return 'review_batch_self'
  return null
}

/**
 * The fields task_update copies from the call into the row.
 *
 * WHY IT IS EXPORTED AND TESTED. The tool declares its parameters and then copies this list; the
 * two drifted once already (`reviewedTaskIds`/`reviewResults` were declared, accepted and dropped,
 * and the row came back {ok:true} with nothing written). A test now compares this list with the
 * tool's own parameters, so a field declared and not written fails the suite instead of the caller.
 */
export const TASK_UPDATE_FIELDS = Object.freeze(['status', 'title', 'objective', 'scope', 'nonScope', 'acceptance', 'priority', 'reason', 'reqIds', 'steps', 'stepsDone', 'caseIds', 'verification', 'criteria', 'constraints', 'reviewedTaskIds', 'reviewResults', 'chore', 'choreReason', 'waiver'])

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
 * FR8: an explicit waiver turns a lifecycle refusal into an accepted, RECORDED decision.
 * A waiver is `{reason, by: 'human'}`: both fields are required, and only the human may waive.
 * A missing waiver leaves the gate's own code; a malformed one is `waiver_required`.
 */
export function validWaiver(waiver) {
  return waiver !== null && typeof waiver === 'object'
    && typeof waiver.reason === 'string' && waiver.reason.trim() !== ''
    && waiver.by === 'human'
}

/** The refusal caused by a MALFORMED waiver, or null (absent keeps the gate's own code). */
export function waiverRefusal(code, waiver) {
  if (waiver === undefined) return null
  if (validWaiver(waiver)) return null
  return { ok: false, code: 'waiver_required', message: `${code} is waived only with {reason, by:'human'}; both fields are required` }
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
    // FR15/FR8: the batch gate. A task whose steps are not all done cannot claim review
    // unless an explicit waiver says why.
    const done = Number.isSafeInteger(patch.stepsDone) ? patch.stepsDone : (Number.isSafeInteger(task.stepsDone) ? task.stepsDone : 0)
    if (Array.isArray(task.steps) && task.steps.length > 0 && done < task.steps.length) {
      if (patch.waiver === undefined) return 'steps_incomplete'
      return validWaiver(patch.waiver) ? null : 'waiver_required'
    }
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

/**
 * The row count past which the FILE, not the work, is the thing at risk. There is no default
 * limit: a board that grew past 1000 rows stopped accepting new work in a real workspace, and
 * "the file is full" was never the owner's decision. A workspace that wants a cap sets
 * `maxRows` explicitly.
 */
const NO_ROW_LIMIT = Number.POSITIVE_INFINITY

/** The most ids one batch lifecycle call may carry. A cleanup batch is tens of rows, not thousands. */
const MAX_BATCH = 100

/** Every command operation that edits or removes a row, and therefore needs its revision. */
const MUTATING_OPS = ['update', 'note', 'link', 'pause', 'resume', 'close', 'cancel', 'remove', 'owner-status']

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
 * Write a board atomically. A crash leaves the previous document, never half of one.
 *
 * NOT LOCKED ON ITS OWN: the read-modify-write in `mutate` holds the file lock around the
 * read AND this write. A direct caller that skips the lock can still lose a concurrent
 * writer's rows, so the exported `writeBoard` takes the lock itself.
 *
 * @param path - Absolute ledger path.
 * @param board - Complete board.
 */
function writeBoardNow(path, board) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, `${JSON.stringify(board, null, 2)}\n`, 'utf8')
  renameSync(temp, path)
}

/** How long a writer waits for another process's lock before it refuses by name. */
const LOCK_WAIT_MS = 10000
/** A lock older than this was left by a process that died holding it; it is taken over. */
const LOCK_STALE_MS = 30000
/** The pause between two lock attempts. Short: a board write is milliseconds, not seconds. */
const LOCK_POLL_MS = 10

/** Sleep without a timer: every ledger operation is synchronous by design. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Run `operation` while holding the cross-process lock of one ledger file.
 *
 * WHY A DIRECTORY. `mkdir` is atomic and fails with EEXIST on every filesystem this kit
 * runs on, which is the O_EXCL primitive Node does not expose for files; the lock is
 * released by `rmdir` in a `finally`, so a thrown operation cannot keep the board locked.
 * A second process WAITS (see LOCK_POLL_MS) instead of writing a board it read before the
 * first process wrote its rows - that lost update is why two servers on one workspace
 * dropped tasks (§4.6 of docs/review/HARNESS-ARCHITECTURE-REVIEW-2026-11-20.md).
 *
 * A lock whose directory is older than `staleMs` is treated as a dead process's leftover
 * and taken over once; the age is the directory's own mtime, so it needs no content.
 *
 * @param path - Absolute ledger path; the lock lives next to it as `<path>.lock`.
 * @param operation - Synchronous work.
 * @param options - `{waitMs, staleMs}` overrides, for tests and constrained filesystems.
 * @returns Whatever `operation` returns.
 */
function withBoardLock(path, operation, options = {}) {
  const waitMs = Number.isSafeInteger(options.waitMs) && options.waitMs >= 0 ? options.waitMs : LOCK_WAIT_MS
  const staleMs = Number.isSafeInteger(options.staleMs) && options.staleMs > 0 ? options.staleMs : LOCK_STALE_MS
  const lock = `${path}.lock`
  mkdirSync(dirname(path), { recursive: true })
  const started = Date.now()
  let held = false
  while (!held) {
    try {
      mkdirSync(lock)
      held = true
    } catch (error) {
      // WINDOWS: mkdir can fail with EPERM instead of EEXIST when the other writer is creating or
      // removing the same directory at that instant (measured: a parallel suite run died with
      // "EPERM ... taskboard.json.lock"). It is the SAME contention EEXIST describes, so it is
      // treated as contention - wait and retry - instead of failing the writer.
      if (error?.code !== 'EEXIST' && error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error
      let age = 0
      try {
        age = Date.now() - statSync(lock).mtimeMs
      } catch {
        continue
      }
      if (age > staleMs) {
        // The holder is gone: a write does not take this long. Taking the lock over beats
        // refusing every write until someone deletes the directory by hand.
        try {
          rmdirSync(lock)
        } catch {
          // Somebody else took it over first; the next attempt sees their lock.
        }
        continue
      }
      if (Date.now() - started >= waitMs) {
        throw new Error(`taskboard: timed out after ${waitMs} ms waiting for the lock ${lock}; another process is writing this board`)
      }
      sleepSync(LOCK_POLL_MS)
    }
  }
  try {
    return operation()
  } finally {
    try {
      rmdirSync(lock)
    } catch {
      // The operation may have removed it (a stale-takeover race); nothing to release.
    }
  }
}

/**
 * Write a board atomically under the file lock: the public single-write entry.
 *
 * @param path - Absolute ledger path.
 * @param board - Complete board.
 * @param options - `{waitMs, staleMs}` lock overrides.
 */
function writeBoard(path, board, options = {}) {
  withBoardLock(path, () => writeBoardNow(path, board), options)
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
 * WHAT IT MAY DECIDE. Only what the ledger records plus what the RUNTIME can prove: a task
 * with linked children whose every `children[]` entry is settled (status not
 * `active`/`paused`) has no running child. A child with no `children[]` entry at all is NOT
 * evidence of anything - it may be running - so the row is reported as `unknown` and left
 * alone, and the same holds for a child whose entry still reads `active`: the entry is only
 * the last write the process managed. `options.gone` closes that gap for the runtime that
 * holds the session: a child it can prove it no longer has is settled like a finished one.
 * The one case it cannot see is a child still running in ANOTHER process on the same
 * workspace - that process sends no event here, so its child reads gone. A task with no
 * linked children is the root's own inline work and is skipped.
 *
 * @param board - Parsed board; mutated in place.
 * @param limit - Timeline entries per task.
 * @param options - `{gone}`: `(childId) => boolean`, true only when the runtime proves the
 *   child is not there. Absent keeps the ledger-only rule.
 * @returns Counts and the ids it changed, so a caller can quote them.
 */
export function reconcileTasks(board, limit = 120, options = {}) {
  const result = { checked: 0, fixed: 0, blocked: 0, review: 0, running: 0, unknown: 0, vanished: 0, ids: [] }
  // THE SECOND WITNESS. The ledger's `children[].status` is written when a child links and when
  // one settles; a child that died with its process wrote neither, so the row says `active`
  // forever. `options.gone` is the runtime's answer for one session id (`true` only when the
  // runtime can prove it holds no such child), and it is what lets a load-time sweep settle
  // the rows a restart left behind. Without the predicate this function keeps its old rule and
  // touches nothing it cannot prove from the ledger.
  const goneProof = typeof options?.gone === 'function' ? options.gone : () => false
  const vanished = (childId) => {
    try {
      return goneProof(childId) === true
    } catch {
      return false
    }
  }
  for (const task of Array.isArray(board?.tasks) ? board.tasks : []) {
    if (displayStatus(task?.status) !== 'active') continue
    const linked = Array.isArray(task.childSessionIds) ? task.childSessionIds.filter((id) => typeof id === 'string' && id !== '') : []
    if (linked.length === 0) continue
    result.checked += 1
    const children = Array.isArray(task.children) ? task.children : []
    const known = linked.map((id) => children.find((entry) => entry?.sessionId === id))
    const running = linked.findIndex((childId, index) => {
      const entry = known[index]
      return entry !== undefined && (entry.status === 'active' || entry.status === 'paused') && !vanished(childId)
    })
    if (running >= 0) {
      // A genuinely running child is never touched: that is the one claim `active` makes.
      result.running += 1
      continue
    }
    const unproven = linked.findIndex((childId, index) => known[index] === undefined && !vanished(childId))
    if (unproven >= 0) {
      result.unknown += 1
      continue
    }
    const disappeared = linked.filter((childId, index) => {
      const entry = known[index]
      return vanished(childId) && (entry === undefined || entry.status === 'active' || entry.status === 'paused')
    })
    if (disappeared.length > 0) result.vanished += disappeared.length
    const failed = known.filter((entry) => entry !== undefined && FAILED_STOP_REASONS.includes(String(entry.stopReason ?? '').toLowerCase()))
    task.status = failed.length === 0 ? 'review' : 'blocked'
    if (failed.length > 0) task.reason = `reconciled: child ${failed[0].sessionId} ended with ${failed[0].stopReason}`
    task.revision = (Number.isSafeInteger(task.revision) ? task.revision : 1) + 1
    task.updatedAt = now()
    const vanishedNote = disappeared.length === 0
      ? ''
      : `; ${disappeared.length} of them had disappeared from the runtime (no subagent/end arrived)`
    timeline(task, 'reconciled', 'orchestrator', failed.length === 0
      ? `Task moved to review: its ${linked.length} linked child session(s) had all settled${vanishedNote}`
      : `Task blocked: child ${failed[0].sessionId} ended with ${failed[0].stopReason}${vanishedNote}`, { sessionIds: linked }, limit)
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
  //
  // WHY THE CHAT IS PART OF THE KEY. A specialist session belongs to the chat that started
  // it, so the same role in two chats is two rows - the normal shape, not a collision. The
  // name collides only when ONE chat holds two rows for it; counting rows across the whole
  // board would flag every per-chat role the moment a second chat delegated.
  const byLabel = new Map()
  for (const row of rows) {
    const label = normalizeAgentRole(row?.role)
    if (label === '') continue
    const key = `${label}|${typeof row?.chatSessionId === 'string' ? row.chatSessionId : ''}`
    byLabel.set(key, (byLabel.get(key) ?? 0) + 1)
  }
  return rows.map((agent) => {
    const lastTaskId = typeof agent.lastTaskId === 'string' ? agent.lastTaskId : ''
    const orphan = lastTaskId !== '' && !ids.has(lastTaskId)
    const updated = Date.parse(String(agent.updatedAt ?? agent.createdAt ?? ''))
    const stale = Number.isNaN(updated) ? false : nowMs - updated > staleAfterMs
    const legacy = typeof agent.preset !== 'string' || agent.preset.trim() === ''
    const conflict = (byLabel.get(`${normalizeAgentRole(agent.role)}|${typeof agent.chatSessionId === 'string' ? agent.chatSessionId : ''}`) ?? 0) > 1
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
  // ACTED ON; `maxRows` bounds the file itself when a workspace asks for that.
  //
  // `0` is UNLIMITED for both, and it has to be spelled `0` for maxTasks: a workspace that
  // does not want a cap on work in flight says so explicitly, while every other unusable
  // value (a negative, a string, `null`, a missing key) still falls back to 200. For maxRows
  // the default IS no limit: the shipped cap fired without the owner's decision and refused
  // new work at 1000 rows, so a missing key now means unlimited and only an explicit positive
  // integer bounds the file.
  const maxTasks = config.maxTasks === 0
    ? Number.POSITIVE_INFINITY
    : (Number.isSafeInteger(config.maxTasks) && config.maxTasks > 0 ? config.maxTasks : 200)
  const maxRows = Number.isSafeInteger(config.maxRows) && config.maxRows > 0 ? config.maxRows : NO_ROW_LIMIT
  const timelineLimit = Number.isSafeInteger(config.timelineLimit) && config.timelineLimit > 0 ? config.timelineLimit : 120
  const staleAfterMs = Number.isSafeInteger(config.staleAfterMs) && config.staleAfterMs > 0 ? config.staleAfterMs : STALE_AFTER_MS
  // The cross-process lock: a writer WAITS for another process for `lockWaitMs`, and a lock
  // directory older than `lockStaleMs` belongs to a process that died holding it.
  const lockWaitMs = Number.isSafeInteger(config.lockWaitMs) && config.lockWaitMs >= 0 ? config.lockWaitMs : LOCK_WAIT_MS
  const lockStaleMs = Number.isSafeInteger(config.lockStaleMs) && config.lockStaleMs > 0 ? config.lockStaleMs : LOCK_STALE_MS
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
   * Read one board, run a synchronous operation, and write it atomically when the operation
   * reports a change.
   *
   * THE READ AND THE WRITE SIT INSIDE ONE LOCK. Serializing only the write keeps a second
   * process's read-then-write pair intact, and that pair is what loses rows: two servers on
   * one workspace each read the whole board, each add a row, and the later rename drops the
   * earlier row (§4.6 of docs/review/HARNESS-ARCHITECTURE-REVIEW-2026-11-20.md). With the
   * lock around both, the second process reads what the first one wrote.
   */
  const mutate = (cwd, operation) => {
    const path = pathFor(cwd)
    return withBoardLock(path, () => {
      const board = readBoard(path)
      const before = board.revision
      const result = operation(board)
      const changed = board.revision !== before || result?.changed === true
      if (changed) {
        board.revision = before + 1
        writeBoardNow(path, { ...board, tasks: board.tasks, agents: board.agents ?? [] })
      }
      return result?.value ?? result
    }, { waitMs: lockWaitMs, staleMs: lockStaleMs })
  }

  /**
   * Mirror the tasks a lifecycle action just changed. `create`/`update`/`linkChild` already
   * mirror their row; `close`, `cancel`, `pause`, `resume`, `childEnded` and `reconcile` are
   * separate write points and used to leave the register behind (measured: TASK-238/239 read
   * `review` while the board said `done`). A batch reads the changed ids back once.
   */
  const mirrorTasks = (cwd, tasks) => {
    for (const task of Array.isArray(tasks) ? tasks : []) {
      if (task === undefined || task === null) continue
      hooks.mirror?.(cwd, task)
    }
  }
  const mirrorByIds = (cwd, ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return
    const board = readBoard(pathFor(cwd))
    mirrorTasks(cwd, ids.map((id) => board.tasks.find((task) => task.id === id)).filter((task) => task !== undefined))
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
   *
   * `scope: 'workspace'` is the deliberate exception: a ROOT agent may write a task another
   * chat created, because there is ONE ledger per workspace and a chat board is a view of
   * it. Measured 2026-11-12: the orchestrator could READ an old canvas task from another
   * chat and every write on it was refused with `other_chat`, so the directive that task
   * needed could not be attached to the task that owns it. The scope is never inferred from
   * the task - the caller asks for it, the tool layer refuses it for a child session, and
   * the timeline records which chat the write came from.
   */
  const writable = (task, chatId, actor, scope) => {
    if (chatId === '' || actor === 'human') return true
    if (scope === 'workspace') return true
    const owner = chatOf(task)
    return owner !== null && owner === chatId
  }
  const otherChat = (task) => ({ value: { ok: false, code: 'other_chat', chatId: chatOf(task) } })

  /**
   * The task a child session currently serves.
   *
   * THE LEASE IS ON THE ROLE ROW, not on the task lists, because one child session can be
   * handed to a second task while the first still names it. Measured 2026-11-12: a role's
   * session was reused for a second brief (delegate_task returned `reused: true`), both
   * tasks listed the same child, and closing the FIRST task stopped the child that was by
   * then working the second one. `linkChild` now transfers the lease and rewrites both
   * lists; this lookup is the authority for the interrupt path, with a newest-link fallback
   * for rows written before the lease existed.
   */
  const leaseOf = (board, childId) => {
    const agent = (board.agents ?? []).find((entry) => entry.sessionId === childId)
    const taskId = typeof agent?.currentTaskId === 'string' ? agent.currentTaskId : ''
    if (taskId !== '') return taskId
    const owners = (board.tasks ?? []).filter((entry) => Array.isArray(entry.childSessionIds) && entry.childSessionIds.includes(childId))
    if (owners.length === 0) return ''
    return owners.reduce((newest, entry) => (String(entry.updatedAt ?? '') >= String(newest.updatedAt ?? '') ? entry : newest)).id
  }

  /**
   * Interrupt the linked children this task actually OWNS and report per-child outcomes.
   *
   * The hook is the only path to the subagent runtime; it throws when the child cannot be
   * stopped, and the caller fails closed (the task keeps its previous status). Nothing is
   * mutated here: a batch that writes other rows must not persist a half-stopped task. A
   * child whose lease belongs to another task is SKIPPED and reported, never stopped: the
   * stop exists to end work on THIS task, and killing a child that has since been handed
   * another one is the 2026-11-12 defect that aborted a frame-deletion child when an
   * unrelated schema task was closed.
   *
   * LIVENESS COMES FROM THE RUNTIME, NOT FROM `subagent/end`. The end event exists only in
   * the process that saw the child settle: a child that died with its process, or whose Host
   * was restarted, leaves the ledger saying `active` and sends nothing. Asking the runtime
   * for the child (`hooks.childLiveness`) is the only honest answer, and it changes the
   * outcome: a child the runtime still runs is interrupted as before, while a child it no
   * longer holds is SETTLED - reported in `gone`, never attempted. Attempting it is what
   * broke acceptance: the runtime dereferences the target it no longer has and throws
   * (measured: `Cannot read properties of undefined (reading 'id')` on a task with a linked
   * child), so every such close returned `interrupt_failed` and the only way out was to
   * cancel the task and lose its acceptance. An `idle` child has no running turn to stop, so
   * it is settled too. When the runtime cannot answer (no roster to prove absence from, or an
   * error), the old fail-closed interrupt runs unchanged: an unproven child is never silently
   * declared dead.
   */
  const interruptChildren = (task, requestedParent, board) => {
    const parentSessionId = typeof task.parentSessionId === 'string' && task.parentSessionId !== ''
      ? task.parentSessionId
      : (typeof requestedParent === 'string' ? requestedParent : '')
    const interrupted = []
    const errors = []
    const skipped = []
    const gone = []
    const liveness = typeof hooks.childLiveness === 'function' ? hooks.childLiveness : () => undefined
    for (const childId of Array.isArray(task.childSessionIds) ? task.childSessionIds : []) {
      const lease = leaseOf(board, childId)
      if (lease !== '' && lease !== task.id) {
        skipped.push({ childId, taskId: lease })
        continue
      }
      let live
      try {
        live = liveness(childId)
      } catch {
        live = undefined
      }
      if (live === 'gone' || live === 'idle') {
        gone.push({ childId, state: live })
        continue
      }
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
    return { parentSessionId, interrupted, errors, skipped, gone }
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
        // A stopped child owns no task. Leaving currentTaskId behind would keep the role
        // "busy" forever and force a fresh session on every later delegation.
        agent.currentTaskId = null
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
    if (!writable(task, chatId, input?.actor, input?.scope)) return { ok: false, code: 'other_chat', chatId: chatOf(task) }
    const from = displayStatus(task.status)
    if (from === 'cancelled') return { ok: true, task, interrupted: [], errors: [], note: 'already cancelled' }
    if (from === 'done') return { ok: false, code: 'terminal', task }
    // FORCE IS FOR ARTIFACT CLEANUP: a row whose linked sessions belong to a process that no
    // longer exists cannot be interrupted, and a fail-closed cancel would leave it in review
    // forever. The owner asserts the work is dropped; children are marked settled, not stopped.
    const forced = input?.force === true
    const { interrupted, errors, skipped, gone } = forced
      ? { interrupted: [], errors: [], skipped: [], gone: [] }
      : interruptChildren(task, input?.parentSessionId, board)
    if (errors.length > 0) return { ok: false, code: 'interrupt_failed', task, interrupted, errors }
    markChildren(board, task, 'sleeping', 'sleeping')
    task.status = 'cancelled'
    const note = reason === '' ? 'Cancelled with no reason given' : 'Cancelled: ' + reason
    const result = resultOf({ decisions: [note] }, task.result)
    if (result !== undefined) task.result = result
    task.revision += 1
    task.updatedAt = now()
    timeline(task, 'cancelled', input?.actor === 'human' ? 'human' : 'orchestrator', note, { sessionIds: interrupted }, timelineLimit)
    return { ok: true, task, interrupted, errors, skipped, gone, note, changed: true }
  }

  /**
   * Accept one task after checking its result. The result supplied at acceptance fills only
   * missing fields; a summary already recorded is never rewritten. No board mutation happens
   * until the result gate and the child stop both pass, so a batch can persist other rows
   * without persisting a half-accepted one.
   */
  const closeOne = (board, task, input, incoming) => {
    const chatId = typeof input?.chatId === 'string' ? input.chatId : ''
    if (!writable(task, chatId, input?.actor, input?.scope)) return { ok: false, code: 'other_chat', chatId: chatOf(task) }
    const from = displayStatus(task.status)
    if (from === 'cancelled') return { ok: false, code: 'cancelled', task }
    if (from === 'done') return { ok: true, task, interrupted: [], errors: [], note: 'already done' }
    if (from !== 'review') return { ok: false, code: 'needs_review', task }
    const next = fillResult(task.result, incoming)
    const refusal = acceptanceRefusal(next)
    if (refusal !== null) return { ok: false, code: refusal, task }
    const { interrupted, errors, skipped, gone } = interruptChildren(task, input?.parentSessionId, board)
    if (errors.length > 0) return { ok: false, code: 'interrupt_failed', task, interrupted, errors }
    const recorded = JSON.stringify(next) !== JSON.stringify(task.result ?? {})
    task.result = Object.keys(next).length > 0 ? next : undefined
    markChildren(board, task, 'sleeping', 'sleeping')
    task.status = 'done'
    task.revision += 1
    task.updatedAt = now()
    // A CLOSE THAT RAN WITH A DISAPPEARED CHILD SAYS SO in the timeline: the owner reads the
    // same record the tool returned, and "the child was gone" is the fact that made the close
    // possible without a force flag.
    const settledNote = gone.length > 0 ? `; child ${gone.map((entry) => entry.childId).join(', ')} had disappeared (${gone[0].state})` : ''
    timeline(task, 'closed', input?.actor === 'human' ? 'human' : 'orchestrator', 'Closed as done' + (recorded ? '; result recorded at acceptance' : '') + settledNote, { sessionIds: interrupted }, timelineLimit)
    return { ok: true, task, interrupted, errors, skipped, gone, changed: true, resultRecorded: recorded }
  }

  /**
   * The LIVE state of a task's children. The ledger's `children[].status` is written at link
   * and settle time, so a child that is still linked reads `active` even when its turn ended
   * between those writes; only the runtime knows who is working NOW. `running: true` comes
   * from the agents service, `running: false` from a known-idle session, and an unresolved id
   * keeps the field absent rather than claiming either.
   */
  const liveSession = typeof hooks.liveSession === 'function' ? hooks.liveSession : () => undefined
  const withLiveChildren = (task) => {
    // A CLOSED TASK CANNOT BE WORKING: its session may be running for a DIFFERENT task (a
    // role session is reused), so liveness is reported only on `active` rows. A review/done
    // child is history, never "1 running" on the finished card.
    const liveAllowed = displayStatus(task?.status) === 'active'
    const children = (Array.isArray(task?.children) ? task.children : []).map((child) => {
      if (child === null || typeof child !== 'object' || typeof child.sessionId !== 'string') return child
      let running
      try {
        running = liveAllowed ? liveSession(child.sessionId) : false
      } catch {
        running = undefined
      }
      return running === true || running === false ? { ...child, running } : child
    })
    const runningChildSessionIds = children
      .filter((child) => child !== null && typeof child === 'object' && child.running === true && typeof child.sessionId === 'string')
      .map((child) => child.sessionId)
    return { ...task, children, runningChildSessionIds }
  }

  /** Compact list row; the board UI uses the full task document. */
  const summary = (task) => {
    const assignment = assignmentOf(task)
    const live = withLiveChildren(task)
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
      children: live.children,
      runningChildSessionIds: live.runningChildSessionIds,
      revision: task.revision,
      updatedAt: task.updatedAt,
    }
  }

  /**
   * Does the RUNTIME prove it holds no such child?
   *
   * `false` means "not proven", never "alive": a composition without the liveness hook keeps
   * the old fail-closed rules, and a runtime that cannot answer is not asked twice.
   */
  const runtimeGone = (childId) => {
    if (typeof hooks.childLiveness !== 'function') return false
    try {
      return hooks.childLiveness(childId) === 'gone'
    } catch {
      return false
    }
  }

  /** Settle `active` rows whose children have finished or disappeared, and mirror what it changed. */
  const reconcileBoard = (cwd) => {
    const out = mutate(cwd, (board) => {
      const result = reconcileTasks(board, timelineLimit, { gone: runtimeGone })
      return { changed: result.fixed > 0, value: { ok: true, ...result } }
    })
    if (out?.ok === true && Array.isArray(out.ids) && out.ids.length > 0) mirrorByIds(cwd, out.ids)
    return out
  }

  /**
   * THE LOAD-TIME SWEEP. A board is swept once per process: the first read of a workspace
   * settles the `active` rows a restart left behind (the child's `subagent/end` never arrived
   * in THIS process), so the panel and the orchestrator see "review, waiting for acceptance"
   * instead of "in flight" forever. Once per process and path, because a read that writes on
   * every call would turn the panel's polling into a write loop; a refusal is logged and the
   * board is left exactly as it was.
   */
  const swept = new Set()
  const sweepOnLoad = (cwd) => {
    let path
    try {
      path = pathFor(cwd)
    } catch {
      return
    }
    if (swept.has(path)) return
    swept.add(path)
    try {
      reconcileBoard(cwd)
      // The register check rides the same once-per-process load: it is the half of the mirror
      // that heals a divergence no retry could see (the write never happened at all).
      hooks.onLoad?.(cwd)
    } catch (error) {
      logger?.warn?.(`taskboard: the load-time sweep of ${path} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    file,
    pathFor,
    /** One chat's board, or the whole workspace with `all`. */
    list(cwd, options = {}) {
      sweepOnLoad(cwd)
      const chatId = typeof options?.chatId === 'string' ? options.chatId : ''
      const all = options?.all === true
      return readBoard(pathFor(cwd)).tasks
        .filter((task) => all || chatId === '' || chatOf(task) === chatId)
        .map(summary)
    },
    /** Persistent specialists for one workspace, with stale/orphan flags. */
    /**
     * The roster, optionally for one chat.
     *
     * A specialist session belongs to the chat that started it (`chatSessionId`), so a caller
     * that is about to continue a role must read only its own chat's rows: another chat's
     * sleeping child is unreachable (the subagent runtime delivers to direct children only).
     * Omitting `chatId` keeps the whole-board read the panel and the catalog use.
     */
    agents(cwd, chatId) {
      sweepOnLoad(cwd)
      const rows = annotateAgents(readBoard(pathFor(cwd)), staleAfterMs)
      if (typeof chatId !== 'string' || chatId === '') return rows
      return rows.filter((agent) => (typeof agent.chatSessionId === 'string' ? agent.chatSessionId : '') === chatId)
    },
    /**
     * Find one persistent specialist by role (case-insensitive), scoped to a chat when given.
     *
     * With a `chatId`, only a row that records THAT chat matches: a workspace-global lookup
     * used to hand a new chat another chat's sleeping child as a reuse target, and the row's
     * preset then refused the new chat's own composition.
     */
    findAgent(cwd, role, chatId) {
      const wanted = typeof role === 'string' ? role.trim().toLowerCase() : ''
      if (wanted === '') return undefined
      const rows = annotateAgents(readBoard(pathFor(cwd)), staleAfterMs)
      const scoped = typeof chatId === 'string' && chatId !== ''
      return rows.find((agent) => agent.role.trim().toLowerCase() === wanted
        && (!scoped || (typeof agent.chatSessionId === 'string' ? agent.chatSessionId : '') === chatId))
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
        // ONE ROW PER (NAME, CHAT). A specialist session is a direct child of the chat that
        // started it, so the chat is part of a role's identity, not a property of it: the same
        // name in chat B is a DIFFERENT specialist with its own session, its own preset and its
        // own history. Matching by label alone made the second chat collide with the first -
        // `preset_conflict` for a composition the first chat had chosen, or a repointed row
        // that made the first chat's child unreachable. A caller that passes no chat (older
        // tooling) keeps the old whole-board match.
        const sameChat = (agent) => (typeof agent.chatSessionId === 'string' ? agent.chatSessionId : '') === chatSessionId
        const existing = chatSessionId === ''
          ? agents.find((agent) => normalizeAgentRole(agent.role) === normalizeAgentRole(role))
          : agents.find((agent) => normalizeAgentRole(agent.role) === normalizeAgentRole(role) && sameChat(agent))
        const time = now()
        // A ROLE LABEL OWNS ONE TOOL SET - WITHIN ONE CHAT. Reusing the label with another
        // preset used to overwrite the recorded composition in place, so `AUDIT [reviewer]`
        // became `AUDIT [critic]` between two delegations and the catalog showed one role where
        // two specialties had been used - measured in ~/tasks/autolabel_pipeline (2026-11-11,
        // revision 1906): a reviewer row and a critic row collapsed into `AUDIT [critic]`.
        // The ledger keeps ONE row per label per chat and refuses the switch inside it;
        // splitting the label (REVIEWER / CRITIC, or a genuinely new name) is the caller's
        // decision, and `force` is the recorded exception for correcting a row that was wrong.
        // Another chat's row for the same label never blocks this chat: that row is history
        // here, and its preset is that chat's choice.
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
            currentTaskId: input?.taskId ?? null,
            generation: 1,
            history: [],
            ...(preset === '' ? {} : { preset }),
            ...(chatSessionId === '' ? {} : { chatSessionId }),
            createdAt: time,
            updatedAt: time,
          })
        } else {
          // A role is durable, the agent behind it is not: a fresh child (another chat, or the
          // same chat after a busy session) is a NEW session, and this row - the row of ITS
          // chat - is repointed. Keeping the superseded ids in the history array is what makes
          // that visible; silently overwriting the field is how the ledger used to claim a
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
      sweepOnLoad(cwd)
      const task = readBoard(pathFor(cwd)).tasks.find((entry) => entry.id === id)
      return task === undefined ? undefined : withLiveChildren(task)
    },
    /** Create a task; returns the full record, or a named refusal. */
    create(cwd, input, actor = 'orchestrator') {
      const title = typeof input?.title === 'string' ? input.title.trim() : ''
      if (title === '') throw new Error('taskboard: a task needs a non-empty title')
      // P2.1: a review batch names 2-8 tasks that must exist on this board.
      const batch = reviewedTaskIdsOf(input?.reviewedTaskIds)
      const batchProblem = batchRefusal(batch)
      if (batchProblem !== null) return { ok: false, code: batchProblem }
      if (batch !== null && batch.length > 0) {
        const known = new Map((readBoard(pathFor(cwd)).tasks ?? []).map((entry) => [entry.id, entry]))
        const missing = batch.filter((id) => !known.has(id))
        if (missing.length > 0) return { ok: false, code: 'review_batch_unknown', missing }
      }
      // NO ROLE-LESS TASK. A task belongs to a specialist role (which carries the preset
      // its child runs with) or it is explicitly inline work the owner does itself. The
      // refusal is here rather than in the panel because `delegate_task`, `task_create`
      // and the UI all reach this one function.
      const role = typeof input?.role === 'string' ? input.role.trim().slice(0, 80) : ''
      const inline = role === '' && input?.inline === true
      if (role === '' && !inline) return { ok: false, code: 'needs_role_or_inline' }
      // THE REQUIREMENT GATE (FR10). A task implements a REQ or is an explicitly justified
      // chore; with a project-state core mounted there is no third option. A composition
      // without the core keeps the old behaviour (proof scripts exercise that path directly).
      const reqId = typeof input?.reqId === 'string' ? input.reqId.trim() : ''
      // FR15: a task is the unit of acceptance and may cover SEVERAL requirements; `reqIds`
      // is the batch, `reqId` the first one for the single-requirement callers and the mirror.
      const reqIds = [...new Set([...(Array.isArray(input?.reqIds) ? input.reqIds.map((id) => String(id).trim()) : []), ...(reqId === '' ? [] : [reqId])])].filter((id) => id !== '').slice(0, 10)
      const steps = strings(input?.steps).slice(0, 20)
      const chore = input?.chore === true
      const choreReason = typeof input?.choreReason === 'string' ? input.choreReason.trim() : ''
      if (typeof hooks.mirrorActive === 'function' && hooks.mirrorActive() && reqIds.length === 0 && !(chore && choreReason !== '')) {
        if (input?.waiver === undefined) return { ok: false, code: 'req_required', message: 'a task needs reqIds (the REQs it covers) or reqId (one REQ), or chore:true with a non-empty choreReason; or an explicit waiver {reason, by: "human"}' }
        const waived = waiverRefusal('req_required', input.waiver)
        if (waived !== null) return waived
        if (validWaiver(input?.waiver) && typeof hooks.waive === 'function') hooks.waive(cwd, 'req_required', input.waiver, { title })
      }
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
      const created = mutate(cwd, (board) => {
        const time = now()
        // THE CAP IS ON WORK IN FLIGHT, NOT ON HISTORY. A board that finished 190 tasks and
        // has 5 open ones is not full; it is healthy. Two separate limits, two codes:
        //   board_full      - too much work is open, paused, waiting for review or blocked
        //   board_rows_full - the ledger file is at a row limit the WORKSPACE asked for;
        //                     nothing is ever deleted or rewritten to make room.
        //   maxTasks: 0 is UNLIMITED, so the work-in-flight check is skipped entirely rather
        //   than compared against Infinity: a ledger with 400 actionable rows must accept a
        //   401st. maxRows has NO default: the row guard below fires only when the workspace
        //   named a positive limit, because the shipped 1000-row default refused new work the
        //   owner had asked for.
        const active = board.tasks.filter((task) => ACTIVE_STATUSES.includes(displayStatus(task?.status))).length
        if (Number.isFinite(maxTasks) && active >= maxTasks) {
          return { value: { ok: false, code: 'board_full', active, cap: maxTasks, message: `${active} of ${maxTasks} tasks can still be acted on; close or cancel what is finished, or raise maxTasks` } }
        }
        if (Number.isFinite(maxRows) && board.tasks.length >= maxRows) {
          return { value: { ok: false, code: 'board_rows_full', rows: board.tasks.length, cap: maxRows, message: `the ledger holds ${board.tasks.length} rows (limit ${maxRows}); the file, not the work, is full - nothing is deleted automatically, so raise maxRows or remove it` } }
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
          // A NEW task always states its links, even when it has none: an absent field is the
          // legacy shape ("scan the library"), and a fresh task must not inherit that ambiguity.
          caseIds: caseIdsOf(input?.caseIds),
          // P2: the contract the task is accepted against. A level with no criteria is a claim
          // nobody can check, and the close refuses it by name (see beforeClose).
          ...(verificationOf(input?.verification) === '' ? {} : { verification: verificationOf(input?.verification) }),
          criteria: criteriaOf(input?.criteria),
          ...(batch !== null && batch.length > 0 ? { reviewedTaskIds: batch } : {}),
          ...(strings(input?.constraints).length === 0 ? {} : { constraints: strings(input?.constraints) }),
          ...(typeof input?.reason === 'string' && input.reason.trim() !== '' ? { reason: input.reason.trim().slice(0, 1000) } : {}),
          ...(reqId === '' ? {} : { reqId: reqId.slice(0, 80) }),
          ...(reqIds.length === 0 ? {} : { reqIds: reqIds.map((id) => id.slice(0, 80)) }),
          ...(steps.length === 0 ? {} : { steps }),
          ...(steps.length > 0 && Number.isSafeInteger(input?.stepsDone) ? { stepsDone: Math.max(0, Math.min(steps.length, input.stepsDone)) } : {}),
          ...(chore ? { chore: true } : {}),
          ...(choreReason === '' ? {} : { choreReason: choreReason.slice(0, 1000) }),
          ...(validWaiver(input?.waiver) ? { waiver: { reason: String(input.waiver.reason).slice(0, 1000), by: 'human' } } : {}),
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
      if (created !== undefined && created?.ok !== false) {
        appendRowEvent(cwd, 'create', created)
        hooks.mirror?.(cwd, created)
      }
      return created
    },
    /** Compare-and-set update; a stale revision returns the current task untouched. */
    update(cwd, input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const expected = Number.isSafeInteger(input?.expectedRevision) ? input.expectedRevision : null
      const chatId = typeof input?.chatId === 'string' ? input.chatId : ''
      const updated = mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        if (!writable(task, chatId, input?.actor, input?.scope)) return otherChat(task)
        if (expected !== null && task.revision !== expected) {
          return { value: { ok: false, code: 'stale', task } }
        }
        const patch = input?.patch !== null && typeof input?.patch === 'object' ? input.patch : input
        const refusal = transitionRefusal(task, patch)
        if (refusal !== null) return { value: { ok: false, code: refusal, task } }
        if (validWaiver(patch.waiver) && typeof hooks.waive === 'function') hooks.waive(cwd, 'steps_incomplete', patch.waiver, { id })
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
        // The link between a row and its cases. An empty list is a real value: it says the task
        // owes no case, which is different from a row written before the field existed.
        if (patch.caseIds !== undefined) task.caseIds = caseIdsOf(patch.caseIds)
      if (patch.verification !== undefined) {
        const level = verificationOf(patch.verification)
        if (level === '') delete task.verification
        else task.verification = level
      }
      if (patch.criteria !== undefined) task.criteria = criteriaOf(patch.criteria)
      if (patch.reviewedTaskIds !== undefined) {
        const ids = reviewedTaskIdsOf(patch.reviewedTaskIds)
        const problem = batchRefusal(ids, task.id)
        if (problem !== null) return { value: { ok: false, code: problem, task } }
        const missing = ids.filter((entry) => !board.tasks.some((other) => other.id === entry))
        if (missing.length > 0) return { value: { ok: false, code: 'review_batch_unknown', missing, task } }
        if (ids.length === 0) delete task.reviewedTaskIds
        else task.reviewedTaskIds = ids
      }
      // P2.1: the verdict per reviewed task. Every id exactly once; the close of the reviewed rows
      // is the orchestrator's, so this is a REPORT on the review row, not an action.
      if (patch.reviewResults !== undefined) {
        const list = Array.isArray(patch.reviewResults) ? patch.reviewResults : []
        const wanted = Array.isArray(task.reviewedTaskIds) ? task.reviewedTaskIds : []
        const got = list.map((entry) => (entry !== null && typeof entry === 'object' && typeof entry.taskId === 'string' ? entry.taskId.trim() : ''))
        const verdicts = list.map((entry) => (entry !== null && typeof entry === 'object' && (entry.verdict === 'pass' || entry.verdict === 'fail') ? entry.verdict : ''))
        const missing = wanted.filter((id) => !got.includes(id))
        const unknown = got.filter((id) => !wanted.includes(id))
        if (verdicts.includes('') || missing.length > 0 || unknown.length > 0 || got.length !== wanted.length) {
          return { value: { ok: false, code: 'review_results_incomplete', missing, unknown, task } }
        }
        task.reviewResults = list.map((entry) => ({
          taskId: entry.taskId.trim(),
          verdict: entry.verdict,
          findings: strings(entry.findings),
          evidence: strings(entry.evidence),
        }))
      }
      if (patch.constraints !== undefined) {
        const constraints = strings(patch.constraints)
        if (constraints.length === 0) delete task.constraints
        else task.constraints = constraints
      }
        if (typeof patch.reason === 'string') {
          if (patch.reason.trim() === '') delete task.reason
          else task.reason = patch.reason.trim().slice(0, 1000)
        }
        // The requirement reference can be set or cleared after creation; the gate itself is
        // enforced on create, where a task gets its identity.
        if (typeof patch.reqId === 'string') {
          if (patch.reqId.trim() === '') delete task.reqId
          else task.reqId = patch.reqId.trim().slice(0, 80)
        }
        if (Array.isArray(patch.reqIds)) {
          const ids = [...new Set(patch.reqIds.map((id) => String(id).trim()))].filter((id) => id !== '').slice(0, 10)
          if (ids.length === 0) delete task.reqIds
          else task.reqIds = ids
        }
        if (Array.isArray(patch.steps)) {
          const list = strings(patch.steps).slice(0, 20)
          if (list.length === 0) { delete task.steps; delete task.stepsDone }
          else { task.steps = list; if (Number.isSafeInteger(patch.stepsDone)) task.stepsDone = Math.max(0, Math.min(list.length, patch.stepsDone)) }
        } else if (Number.isSafeInteger(patch.stepsDone) && Array.isArray(task.steps)) {
          task.stepsDone = Math.max(0, Math.min(task.steps.length, patch.stepsDone))
        }
        if (patch.chore === true) task.chore = true
        if (patch.choreReason !== undefined) {
          if (String(patch.choreReason).trim() === '') delete task.choreReason
          else task.choreReason = String(patch.choreReason).trim().slice(0, 1000)
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
        const editedOrigin = input?.scope === 'workspace' && chatId !== '' && chatOf(task) !== chatId ? ` (from chat ${chatId})` : ''
        timeline(task, 'edited', input?.actor === 'human' ? 'human' : 'orchestrator', 'Task edited' + editedOrigin, {}, timelineLimit)
        return { changed: true, value: { ok: true, task } }
      })
      if (updated !== undefined && updated?.ok !== false) {
        appendRowEvent(cwd, 'update', updated.task)
        hooks.mirror?.(cwd, updated.task)
      }
      return updated
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
        if (!writable(task, chatId, input?.actor, input?.scope)) return otherChat(task)
        task.revision += 1
        task.updatedAt = now()
        const origin = input?.scope === 'workspace' && chatId !== '' && chatOf(task) !== chatId ? `[from chat ${chatId}] ` : ''
        timeline(task, 'note', input?.actor === 'human' ? 'human' : 'orchestrator', (origin + text).slice(0, 1000), {}, timelineLimit)
        return { changed: true, value: { ok: true, task } }
      })
    },
    /** Link one child session and move the task active. */
    linkChild(cwd, input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const childId = typeof input?.sessionId === 'string' ? input.sessionId : ''
      const chatId = typeof input?.chatId === 'string' ? input.chatId : ''
      if (childId === '') return { ok: false, code: 'empty' }
      const linked = mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        if (!writable(task, chatId, input?.actor, input?.scope)) return otherChat(task)
        // ONE CHILD SERVES ONE TASK. Linking a session that another task still lists would
        // leave the old task able to interrupt work it no longer owns - the 2026-11-12
        // frame-deletion abort. The link is therefore a LEASE TRANSFER: every other task
        // loses the id, its child row is closed as `moved`, and the move is on its timeline
        // so the old task does not read as "still delegated" with no visible reason.
        const movedFrom = []
        for (const other of board.tasks) {
          if (other.id === task.id) continue
          if (!Array.isArray(other.childSessionIds) || !other.childSessionIds.includes(childId)) continue
          other.childSessionIds = other.childSessionIds.filter((value) => value !== childId)
          // The donor no longer owns the child, so it must not keep naming it as the owner
          // either; the label stays, the session address goes.
          if (other.owner !== null && typeof other.owner === 'object' && other.owner.sessionId === childId) {
            const { sessionId: _moved, ...owner } = other.owner
            other.owner = owner
          }
          const otherChildren = Array.isArray(other.children) ? other.children : []
          const moved = otherChildren.find((child) => child.sessionId === childId)
          if (moved !== undefined) Object.assign(moved, { status: 'moved', endedAt: now() })
          other.children = otherChildren
          other.revision += 1
          other.updatedAt = now()
          timeline(other, 'note', 'orchestrator', `Child session ${childId} was handed to task ${task.id}; this task no longer owns it and cannot stop it`, { sessionId: childId }, timelineLimit)
          movedFrom.push(other.id)
        }
        if (!task.childSessionIds.includes(childId)) task.childSessionIds.push(childId)
        const agent = (board.agents ?? []).find((entry) => entry.sessionId === childId)
        if (agent !== undefined) {
          agent.currentTaskId = task.id
          agent.status = 'active'
          agent.updatedAt = now()
        }
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
        const movedFromTasks = movedFrom.map((otherId) => board.tasks.find((entry) => entry.id === otherId)).filter((entry) => entry !== undefined)
        return { changed: true, value: { ok: true, task, movedFrom, movedFromTasks } }
      })
      // THE LINK IS THE FACT THE STATE PANEL NEEDS: without mirroring here, a delegated task
      // reaches the register one update too late and its card cannot open the child session.
      // THE DONOR TASKS ARE MIRRORED TOO: the lease moved the child away from them, and a
      // stale donor row kept offering a session another task owns.
      if (linked !== undefined && linked?.ok === true && linked.task !== undefined) {
        hooks.mirror?.(cwd, linked.task)
        mirrorTasks(cwd, linked.movedFromTasks)
      }
      return linked
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
            // The child is free again. The lease is what the delegator reads to decide
            // "reuse this role session or start a fresh one", so a settled child that kept
            // a lease would force a new session on every later delegation.
            agent.currentTaskId = null
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
        if (result !== undefined) {
          last = result
          if (result?.ok === true) mirrorTasks(link.cwd, [result.task])
        }
      }
      return last
    },
    /**
     * Settle `active` rows the ledger can prove have no running child.
     *
     * Board-level by design: it is not a transition of one task, so it takes no revision and
     * never writes a task whose children are still running (see reconcileTasks). `changed`
     * comes from the result, because the helper bumps the per-task revision, not the board's.
     * A child the runtime proves it no longer holds counts as settled, exactly as the
     * load-time sweep does.
     */
    reconcile(cwd) {
      return reconcileBoard(cwd)
    },
    /** Pause a task and interrupt its linked children; fail closed on interrupt errors. */
    pause(cwd, input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const requestedParent = typeof input?.parentSessionId === 'string' && input.parentSessionId !== '' ? input.parentSessionId : ''
      const chatId = typeof input?.chatId === 'string' ? input.chatId : ''
      const paused = mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        if (!writable(task, chatId, input?.actor, input?.scope)) return otherChat(task)
        if (['done', 'cancelled'].includes(displayStatus(task.status))) return { value: { ok: false, code: 'closed', task } }
        const { interrupted, errors, skipped, gone } = interruptChildren(task, requestedParent, board)
        if (errors.length > 0) return { value: { ok: false, code: 'interrupt_failed', task, interrupted, errors } }
        markChildren(board, task, 'paused', 'paused')
        task.status = 'paused'
        task.revision += 1
        task.updatedAt = now()
        timeline(task, 'paused', input?.actor === 'human' ? 'human' : 'orchestrator', `Paused${interrupted.length === 0 ? '' : `; interrupted ${interrupted.length} child session(s)`}`, { sessionIds: interrupted }, timelineLimit)
        return { changed: true, value: { ok: true, task, interrupted, errors, skipped, gone } }
      })
      if (paused?.ok === true) mirrorTasks(cwd, [paused.task])
      return paused
    },
    /** Resume tracking a paused task. Child sessions are not auto-prompted. */
    resume(cwd, input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const chatId = typeof input?.chatId === 'string' ? input.chatId : ''
      const resumed = mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        if (!writable(task, chatId, input?.actor, input?.scope)) return otherChat(task)
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
      if (resumed?.ok === true) mirrorTasks(cwd, [resumed.task])
      return resumed
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
      const cancelled = mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        const outcome = cancelOne(board, task, input, reason)
        if (outcome.ok === false) return { value: outcome }
        return {
          changed: outcome.changed === true,
          value: { ok: true, task: outcome.task, interrupted: outcome.interrupted, errors: outcome.errors, ...(Array.isArray(outcome.skipped) && outcome.skipped.length === 0 ? {} : { skipped: outcome.skipped }), note: outcome.note },
        }
      })
      if (cancelled?.ok === true) mirrorTasks(cwd, [cancelled.task])
      return cancelled
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
      const batch = mutate(cwd, (board) => {
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
      if (batch?.ok === true) mirrorByIds(cwd, batch.results.filter((entry) => entry.ok === true).map((entry) => entry.id))
      return batch
    },
    /** Close a task as done and interrupt its linked children; fail closed. */
    close(cwd, input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      // P2.1: THE REVIEWER REPORTS, THE ORCHESTRATOR CLOSES. A child that runs one batch review
      // names several tasks; none of them is its to close, or "reviewed" would mean "accepted by
      // the reviewer" and the orchestrator's per-task acceptance would be a formality.
      const child = typeof input?.parentSessionId === 'string' ? input.parentSessionId : ''
      // SHELL AUDIT (P1 residual): a scoped role's shell is NOT sandboxed; when the audit recorded a
      // product change for a session that worked THIS row, the row is not accepted on its own word.
      // The sessions are the row's own: every child it linked, plus the closing session when it is
      // the row's parent. Checking only the closing session let a row closed by the orchestrator
      // walk past a violation its CHILD recorded.
      {
        let violations = []
        try {
          const parsed = JSON.parse(readFileSync(join(cwd, '.dsh', 'proof-guard-violations.json'), 'utf8'))
          if (Array.isArray(parsed)) violations = parsed
        } catch {
          violations = []
        }
        const row = readBoard(pathFor(cwd)).tasks.find((entry) => entry.id === id)
        const sessions = new Set(Array.isArray(row?.childSessionIds) ? row.childSessionIds.filter((value) => typeof value === 'string') : [])
        if (child !== '') sessions.add(child)
        if (typeof row?.parentSessionId === 'string' && row.parentSessionId !== '') sessions.add(row.parentSessionId)
        const hit = violations.find((entry) => entry !== null && typeof entry === 'object' && sessions.has(entry.sessionId) && Array.isArray(entry.files) && entry.files.length > 0)
        if (hit !== undefined) {
          return {
            ok: false,
            code: 'product_shell_violation',
            message: `the shell driven by session ${hit.sessionId} changed product file(s) that this role may not edit (${hit.files.slice(0, 5).join(', ')}); the change is recorded in .dsh/proof-guard-violations.json and the row cannot be accepted on the tester's word - revert it or have the owning role redo it`,
            files: hit.files,
          }
        }
      }
      if (child !== '' && id !== '') {
        const board = readBoard(pathFor(cwd))
        const owner = (board.tasks ?? []).find((task) => Array.isArray(task.reviewedTaskIds)
          && task.reviewedTaskIds.includes(id)
          && Array.isArray(task.childSessionIds)
          && task.childSessionIds.includes(child)
          && task.status !== 'done'
          && task.status !== 'cancelled')
        if (owner !== undefined) {
          return {
            ok: false,
            code: 'reviewed_task_close',
            message: `task ${id} is reviewed in batch ${owner.id}; a reviewer reports a verdict per task, and the orchestrator closes each reviewed task itself`,
          }
        }
      }
      // THE CASE GATE. An optional consumer: a workspace without the test-cases row keeps the
      // legacy close. A linked AUTOMATED case that is not verified stops the acceptance, and the
      // refusal names it, so a red case cannot be closed away.
      // THE JOURNAL, WHEN THE BOARD HAS ONE. A row the journal has seen must still be the row it
      // saw; a row with no event is legacy (an older tool, a fixture) and closes normally.
      let journalRow
      try {
        journalRow = readBoard(pathFor(cwd)).tasks.find((entry) => entry.id === id)
      } catch {
        journalRow = undefined
      }
      if (journalRow !== undefined) {
        const journal = checkJournalRow(cwd, journalRow)
        if (journal.status === 'mismatch' || journal.status === 'broken') {
          return { ok: false, code: 'TASK_JOURNAL_MISMATCH', message: journal.detail ?? 'the task does not match its journal' }
        }
      }
      const gate = typeof hooks.beforeClose === 'function' ? hooks.beforeClose(cwd, id) : undefined
      if (gate !== undefined && gate !== null && gate.ok === false) return gate
      const closed = mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        // A batch review closes with a verdict for EVERY task it names: a review of three tasks
        // that reports two verdicts is not a review, it is a partial pass dressed as one.
        if (Array.isArray(task.reviewedTaskIds) && task.reviewedTaskIds.length > 0) {
          const reported = Array.isArray(task.reviewResults) ? task.reviewResults.map((entry) => entry?.taskId) : []
          const missing = task.reviewedTaskIds.filter((id) => !reported.includes(id))
          if (missing.length > 0) {
            return { value: { ok: false, code: 'review_results_missing', missing, task } }
          }
        }
        const outcome = closeOne(board, task, input, input?.result)
        if (outcome.ok === false) return { value: outcome }
        return {
          changed: outcome.changed === true,
          value: {
            ok: true,
            task: outcome.task,
            interrupted: outcome.interrupted,
            errors: outcome.errors,
            ...(Array.isArray(outcome.skipped) && outcome.skipped.length === 0 ? {} : { skipped: outcome.skipped }),
            ...(Array.isArray(outcome.gone) && outcome.gone.length === 0 ? {} : { gone: outcome.gone }),
            ...(outcome.note === undefined ? {} : { note: outcome.note }),
            ...(outcome.resultRecorded === true ? { resultRecorded: true } : {}),
          },
        }
      })
      if (closed?.ok === true) {
        appendRowEvent(cwd, 'close', closed.task)
        mirrorTasks(cwd, [closed.task])
      }
      return closed
    },
    /**
     * THE OWNER'S OWN STATUS CHANGE (`/taskboard` op `owner-status`).
     *
     * The lifecycle above is a rule for the AGENT, and the owner asked to be able to overrule it
     * from the Project state panel. So this door takes any status and skips `transitionRefusal`
     * entirely: `open -> done` and `open -> review` are allowed here and refused to a tool call.
     * It is reachable only from a command (a human submit or the panel), never from a model tool,
     * and every write leaves two trails:
     *   - the task's own timeline: kind `status`, actor `human`, `open -> done` and the reason;
     *   - the state journal: a `waiver` event with code `owner_status_override`, the statuses
     *     before/after, the reason, the board id and the TASK id (the mirror runs first so the
     *     TASK id exists when the event is written).
     * A terminal or held target (`done`, `cancelled`, `paused`) stops the linked children through
     * the same lease-aware interrupt as close/cancel; a child that will not stop fails the whole
     * change, so history cannot land above running work. The compare-and-set is the command
     * path's, not this method's: `applyOp` refuses without `expectedRevision` and reports `stale`.
     *
     * @param cwd - workspace root.
     * @param input - `{ id, status, reason?, chatId?, parentSessionId?, actor? }`.
     * @returns `{ ok, task, from, to, interrupted?, errors?, unchanged? }` or a named refusal.
     */
    async setStatusOwner(cwd, input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const wanted = typeof input?.status === 'string' ? input.status.trim() : ''
      if (id === '') return { ok: false, code: 'invalid', message: 'owner-status needs the board task id' }
      if (!STATUSES.includes(wanted)) return { ok: false, code: 'status_invalid', message: `status "${wanted}" is not one of ${STATUSES.join(', ')}` }
      const reason = typeof input?.reason === 'string' ? input.reason.trim().slice(0, 1000) : ''
      const chatId = typeof input?.chatId === 'string' ? input.chatId : ''
      const outcome = mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        if (!writable(task, chatId, input?.actor, input?.scope)) return otherChat(task)
        const from = displayStatus(task.status)
        if (from === wanted) return { value: { ok: true, unchanged: true, task, from, to: wanted, interrupted: [], errors: [] } }
        // No work may outlive a status that says "nothing is running here".
        const held = wanted === 'done' || wanted === 'cancelled' || wanted === 'paused'
        const stop = held ? interruptChildren(task, input?.parentSessionId, board) : { interrupted: [], errors: [], skipped: [], gone: [] }
        if (stop.errors.length > 0) return { value: { ok: false, code: 'interrupt_failed', task, interrupted: stop.interrupted, errors: stop.errors } }
        if (held) markChildren(board, task, 'sleeping', 'sleeping')
        task.status = wanted
        // The blocked reason belongs to blocked: leaving it behind would let a done row read as
        // waiting on something, and a non-blocked row has nothing to explain.
        if (wanted === 'blocked') task.reason = reason
        else delete task.reason
        task.revision += 1
        task.updatedAt = now()
        timeline(task, 'status', 'human', `Owner set the status ${from} -> ${wanted}${reason === '' ? '' : `: ${reason}`}`, { from, to: wanted, ...(reason === '' ? {} : { reason }) }, timelineLimit)
        return { changed: true, value: { ok: true, task, from, to: wanted, interrupted: stop.interrupted, errors: stop.errors, ...(Array.isArray(stop.skipped) && stop.skipped.length === 0 ? {} : { skipped: stop.skipped }), ...(Array.isArray(stop.gone) && stop.gone.length === 0 ? {} : { gone: stop.gone }) } }
      })
      if (outcome === undefined || outcome.ok === false) return outcome ?? { ok: false, code: 'write_failed', message: 'the board write did not report a result' }
      if (outcome.unchanged === true) return outcome
      // MIRROR FIRST: the journal event names the TASK id, and the projections must agree with
      // the board before the command reports success.
      let mirrored
      try {
        const pending = hooks.mirror?.(cwd, outcome.task)
        mirrored = pending !== undefined && typeof pending.then === 'function' ? await pending : pending
      } catch (error) {
        logger?.warn?.(`taskboard: owner status mirrored nothing: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (typeof hooks.recordOwnerStatus === 'function') {
        try {
          await hooks.recordOwnerStatus(cwd, {
            from: outcome.from,
            to: outcome.to,
            reason,
            boardId: outcome.task.id,
            ...(typeof mirrored?.taskId === 'string' ? { taskId: mirrored.taskId } : {}),
          })
        } catch (error) {
          logger?.warn?.(`taskboard: owner status journal failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return outcome
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
      const batch = mutate(cwd, (board) => {
        const items = []
        let changed = false
        for (const id of ids) {
          const task = board.tasks.find((entry) => entry.id === id)
          if (task === undefined) { items.push({ id, ok: false, code: 'not_found' }); continue }
          const gate = typeof hooks.beforeClose === 'function' ? hooks.beforeClose(cwd, id) : undefined
          if (gate !== undefined && gate !== null && gate.ok === false) {
            items.push({ id, ok: false, code: gate.code ?? 'cases_not_green', message: gate.message, ...(Array.isArray(gate.blockers) ? { blockers: gate.blockers } : {}) })
            continue
          }
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
      if (batch?.ok === true) mirrorByIds(cwd, batch.results.filter((entry) => entry.ok === true).map((entry) => entry.id))
      return batch
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
        if (!writable(task, chatId, input?.actor, input?.scope)) return { ok: false, code: 'other_chat', chatId: chatOf(task) }
        tasks.push(task)
        for (const childId of Array.isArray(task.childSessionIds) ? task.childSessionIds : []) addTarget(childId)
      }
      if (sessionId !== '') {
        addTarget(sessionId)
        for (const task of board.tasks) {
          // A sessionId-only stop still must not write another chat's timeline. The runtime's
          // ancestor check is the authority for the stop itself; the ledger write is scoped.
          if (!writable(task, chatId, input?.actor, input?.scope)) continue
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
      // THE OWNER'S DOOR: any status, no lifecycle gate, and a journal event. Reachable from
      // the command only (the Project state panel's status control), never from a model tool.
      if (kind === 'owner-status') return this.setStatusOwner(cwd, { ...op, chatId, parentSessionId: actorSessionId, actor })
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
  // THE PROJECT STATE CORE IS OPTIONAL. When `ccProjectState` is mounted, every created or
  // updated task is mirrored into `state/task/` (found again by `boardId`), the requirement
  // gate is enforced, and the projections are regenerated. Without the core the taskboard
  // keeps its old behaviour (the proof scripts exercise that path).
  const mirrorQueue = new Map()
  const mirrorResults = new Map()
  const coreOf = () => {
    try {
      return ctx.get?.('ccProjectState')
    } catch {
      return undefined
    }
  }
  /**
   * A MIRROR FAILURE IS RETRIED. The register write can fail for a reason that goes away on
   * its own - the state file is being replaced, another process holds its CAS revision, the
   * view regeneration was mid-flight - and the old code answered with one `warn` line, so the
   * board and the register diverged until someone noticed (§4.7 of the review: "the panel
   * shows an old status"). Each attempt waits longer than the last; the failure is reported
   * only after the last one, and `flushMirror` still resolves when the queue drains.
   */
  const MIRROR_ATTEMPTS = 4
  const MIRROR_BACKOFF_MS = 250
  /** Refusals the register makes on PURPOSE: every retry gets the same answer. */
  const PERMANENT_MIRROR_REFUSALS = new Set(['req_required'])
  const delay = (ms) => new Promise((done) => {
    const timer = setTimeout(done, ms)
    if (typeof timer.unref === 'function') timer.unref()
  })
  const mirrorOnce = async (core, cwd, task) => {
    try {
      return await mirrorTask(core, { cwd, task })
    } catch (error) {
      return { ok: false, code: 'mirror_failed', message: error instanceof Error ? error.message : String(error) }
    }
  }
  const scheduleMirror = (cwd, task) => {
    const core = coreOf()
    if (core === undefined || core === null || task === undefined || task === null) return undefined
    const run = async () => {
      let result
      for (let attempt = 1; attempt <= MIRROR_ATTEMPTS; attempt += 1) {
        result = await mirrorOnce(core, cwd, task)
        if (result?.ok !== false) break
        if (PERMANENT_MIRROR_REFUSALS.has(result.code)) break
        if (attempt < MIRROR_ATTEMPTS) await delay(MIRROR_BACKOFF_MS * 2 ** (attempt - 1))
      }
      mirrorResults.set(cwd, result)
      if (result?.ok === false) {
        ctx.logger?.warn?.(`taskboard: TASK mirror for ${task.id} failed after ${MIRROR_ATTEMPTS} attempt(s): ${result.code ?? 'unknown'} ${result.message ?? ''}`.trim())
        return result
      }
      try {
        const state = typeof core.open === 'function' ? core.open(cwd) : core
        if (typeof state.regenerateViews === 'function') await state.regenerateViews()
      } catch (error) {
        ctx.logger?.warn?.(`taskboard: could not regenerate views after mirroring ${task.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
      return result
    }
    const previous = mirrorQueue.get(cwd) ?? Promise.resolve()
    mirrorQueue.set(cwd, previous.then(run, run))
    return mirrorQueue.get(cwd)
  }

  /**
   * THE STARTUP CHECK OF THE REGISTER. The retry above heals a write that failed; this heals
   * a row that failed while the process was not running (a crash between the board write and
   * the mirror, or a mirror that ran in a process that then died). It compares the board's
   * status with its TASK row by `boardId` and re-mirrors only the rows that disagree, once
   * per process and workspace, on the first board read.
   *
   * @returns `{checked, repaired}`, or `{checked: 0, repaired: 0, skipped}` when the core or
   *   its task listing is unavailable.
   */
  const mirrorCheck = async (cwd) => {
    const core = coreOf()
    if (core === undefined || core === null) return { checked: 0, repaired: 0, skipped: 'no-core' }
    const state = typeof core.open === 'function' ? core.open(cwd) : core
    if (state === null || state === undefined || typeof state.list !== 'function') return { checked: 0, repaired: 0, skipped: 'no-state' }
    let rows = []
    try {
      const listed = await state.list('task')
      rows = Array.isArray(listed?.rows) ? listed.rows : []
    } catch (error) {
      return { checked: 0, repaired: 0, skipped: 'unreadable' }
    }
    const byBoard = new Map()
    for (const row of rows) {
      if (typeof row?.boardId === 'string' && row.boardId !== '') byBoard.set(row.boardId, row)
    }
    let checked = 0
    let repaired = 0
    for (const row of service.list(cwd, { all: true })) {
      const register = byBoard.get(row.id)
      if (register === undefined) continue
      checked += 1
      if (register.status === registerStatus(row.status)) continue
      const task = service.get(cwd, row.id)
      if (task === undefined) continue
      await scheduleMirror(cwd, task)
      repaired += 1
    }
    if (repaired > 0) ctx.logger?.info?.(`taskboard: the startup register check re-mirrored ${repaired} of ${checked} task row(s)`)
    return { checked, repaired }
  }
  const service = createService(config, ctx.logger, {
    rootOf,
    /**
     * FR8: the waiver trail. A gate that accepted an explicit waiver writes the code, the
     * reason and the human into the state journal; without a core the waive is a no-op.
     */
    waive(cwd, code, waiver, meta = {}) {
      const core = coreOf()
      if (core === undefined || core === null) return
      const state = typeof core.open === 'function' ? core.open(cwd) : core
      if (state === null || state === undefined || typeof state.journal !== 'function') return
      Promise.resolve(state.journal({ code, reason: String(waiver?.reason ?? ''), by: 'human', ...meta })).catch(() => {})
    },
    /**
     * THE OWNER'S TRAIL. `owner-status` is the one write the lifecycle does not gate, so it is
     * the one write that always leaves a journal record: code, from, to, reason, board id and
     * the TASK id. Awaitable on purpose - the command reports success only after the record is
     * on disk. Without a state core this is a no-op (the board still has its own timeline).
     */
    recordOwnerStatus(cwd, event) {
      const core = coreOf()
      if (core === undefined || core === null) return undefined
      const state = typeof core.open === 'function' ? core.open(cwd) : core
      if (state === null || state === undefined || typeof state.journal !== 'function') return undefined
      return state.journal({ code: 'owner_status_override', by: 'human', ...event })
    },
    mirror: scheduleMirror,
    mirrorActive: () => coreOf() !== undefined,
    // The register check rides the board's own load path, once per workspace and process.
    onLoad: (cwd) => {
      mirrorCheck(cwd).catch((error) => {
        ctx.logger?.warn?.(`taskboard: the startup register check failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    },
    /**
     * WHAT THE RUNTIME HOLDS, per linked child: `'running'`, `'idle'`, `'gone'`, or `undefined`
     * when it cannot answer.
     *
     * `agents.get` is the loaded-session registry of THIS process and `agents.list()` is its
     * roster; a child in neither is not working here - it died with its process or the Host
     * restarted, and no `subagent/end` will ever arrive for it. Without a roster the absence
     * proves nothing (a minimal or fake registry answers only for the ids it holds), so the
     * answer is `undefined` and the caller stays fail-closed.
     */
    childLiveness(childId) {
      if (typeof childId !== 'string' || childId === '') return undefined
      try {
        const agents = ctx.get('agents')
        if (agents === undefined || agents === null || typeof agents.get !== 'function') return undefined
        const agent = agents.get(childId)
        if (agent !== undefined && agent !== null) return agent.status === 'running' ? 'running' : 'idle'
        if (typeof agents.list !== 'function') return undefined
        const roster = agents.list()
        if (!Array.isArray(roster)) return undefined
        return roster.some((entry) => entry?.id === childId) ? 'idle' : 'gone'
      } catch {
        return undefined
      }
    },
    // The task list says who is working NOW; a task can stay `active` long after its child
    // stopped, so the status alone cannot answer it. `agents.list()`/`get()` is the runtime's
    // live view; an absent service leaves the fields out instead of guessing.
    liveSession(childId) {
      try {
        const agent = ctx.get('agents')?.get(childId)
        return agent === undefined ? false : agent.status === 'running'
      } catch {
        return undefined
      }
    },
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
    /**
     * The case gate, when the test-cases plugin is mounted.
     *
     * The service is looked up on every close instead of injected: a profile without the row
     * keeps the legacy behaviour, and a case library that cannot be read fails CLOSED (a gate
     * that cannot see its evidence must not answer "green").
     *
     * THE IMPLEMENTER'S PRESET TRAVELS WITH THE QUESTION. Independence is a comparison: the
     * author of the acceptance case and the session that ran it must not be the preset that did
     * the work. That preset is a property of THIS row (`preset`, or the orchestrator for an
     * inline task), so the taskboard reads it and hands it over instead of letting the case
     * library guess from the closing session. A row with a role and no recorded preset leaves it
     * unknown, and the case gate then refuses: an unknown implementer is not an independent one.
     */
    beforeClose(cwd, id) {
      let cases
      try {
        cases = ctx.get('cases')
      } catch {
        cases = undefined
      }
      if (cases === undefined || cases === null || typeof cases.gateForTask !== 'function') return undefined
      let implementerPreset
      let caseIds
      let verification = ''
      let criteria = []
      try {
        const task = service.get(cwd, id)
        // A task that does not exist is not this gate's refusal to make: the close reports
        // `not_found` itself, with the board as the evidence.
        if (task === undefined || task === null) return undefined
        // P2: the level decides whether a case is evidence at all. `proof` and `case` close on
        // the owner's own proof, and no case is owed; `independent` counts criteria coverage.
        // A row without a level keeps the pre-P2 behaviour (the case gate decides), so an old
        // board and an old library read exactly as they did.
        verification = verificationOf(task.verification)
        criteria = Array.isArray(task.criteria) ? task.criteria : []
        if (verification === 'proof' || verification === 'case') return undefined
        if (typeof task.preset === 'string' && task.preset.trim() !== '') implementerPreset = task.preset.trim()
        else if (task.inline === true || typeof task.role !== 'string' || task.role.trim() === '') implementerPreset = 'orchestrator'
        // THE ROW OWNS THE LINK. An array (even an empty one) is passed as the truth about which
        // cases this task owes; an absent field is a row written before the link existed, and the
        // case library falls back to its scan by linkedTaskId.
        if (Array.isArray(task.caseIds)) caseIds = task.caseIds
      } catch {
        implementerPreset = undefined
        caseIds = undefined
      }
      let gate
      try {
        gate = cases.gateForTask(cwd, id, {
          implementerPreset,
          ...(caseIds === undefined ? {} : { caseIds }),
          ...(verification === '' ? {} : { verification }),
          ...(criteria.length === 0 ? {} : { criteria }),
        })
      } catch (error) {
        return { ok: false, code: 'cases_unreadable', message: `the case library could not be read: ${error?.message ?? error}` }
      }
      if (gate === undefined || gate === null || gate.ok !== false) return undefined
      // AN UNREADABLE FILE IS REFUSED BY NAME. The case library reports it instead of dropping it
      // (a deleted requirement must not look like a satisfied one), and the close says which file
      // and why, because "cases not green" over a file nobody can read is not actionable.
      const broken = Array.isArray(gate.errors) ? gate.errors : []
      if (broken.length > 0) {
        const files = broken.map((entry) => `${entry.id} (${entry.code})`)
        return {
          ok: false,
          code: 'cases_unreadable',
          message: `the case library holds case file(s) that cannot be read: ${files.join(', ')}; a file that cannot be read cannot be judged, so the task cannot be accepted`,
          blockers: Array.isArray(gate.blockers) ? gate.blockers : [],
          errors: broken,
          evidence: Array.isArray(gate.evidence) ? gate.evidence : [],
        }
      }
      // P2: a level that demands criteria coverage is refused as a CONTRACT problem, not as a
      // case problem: the message names the criterion and the file the owner must record or fix.
      if (gate.code === 'CRITERIA_UNCOVERED' || gate.code === 'CRITERIA_REQUIRED') {
        return {
          ok: false,
          code: gate.code,
          message: gate.message,
          ...(Array.isArray(gate.coverage) ? { coverage: gate.coverage } : {}),
          blockers: Array.isArray(gate.blockers) ? gate.blockers : [],
          evidence: Array.isArray(gate.evidence) ? gate.evidence : [],
        }
      }
      const names = Array.isArray(gate.blockers) ? gate.blockers.map(describeBlocker) : []
      return {
        ok: false,
        code: 'cases_not_green',
        message: `linked automated acceptance case(s) are not acceptable evidence: ${names.join('; ') || 'unknown'}; a case closes a task only when the run measured it, another preset wrote and ran it, and its test file still matches`,
        blockers: gate.blockers,
        evidence: Array.isArray(gate.evidence) ? gate.evidence : [],
      }
    },
  })
  service.flushMirror = async (cwd) => {
    await (mirrorQueue.get(cwd) ?? Promise.resolve())
    return mirrorResults.get(cwd) ?? null
  }
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

  /**
   * The `scope` a write tool may honour. Only a ROOT session may widen a write to another
   * chat's task: the workspace ledger is shared, but a child must never edit outside the
   * chat it works in. The refusal is a named code so the model can correct itself.
   */
  const workspaceScope = (args, exec) => {
    if (args?.scope !== 'workspace') return {}
    const id = typeof exec?.agent?.id === 'string' ? exec.agent.id : ''
    const root = typeof rootOf === 'function' && id !== '' ? rootOf(id) : id
    if (id !== '' && root !== '' && root !== id) {
      return { refused: { ok: false, code: 'workspace_scope_child', message: 'a child session cannot write outside its own chat; ask the orchestrator to record this' } }
    }
    return { scope: 'workspace' }
  }

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
      reqId: { type: 'string', description: 'The REQ this task implements (REQ-001). Required with the project-state core, unless reqIds or chore+choreReason is given.' },
      reqIds: { type: 'array', items: { type: 'string' }, description: 'Several REQs this one task covers (a batch). The requirement gate accepts a non-empty reqIds.' },
      waiver: { type: 'object', additionalProperties: false, description: 'Explicit waiver of a lifecycle gate: {reason, by: "human"}. Both fields are required; the waiver is written to the state journal.', properties: { reason: { type: 'string' }, by: { type: 'string' } } },
      steps: { type: 'array', items: { type: 'string' }, description: 'The steps of the batch, in order; the board shows how many are done.' },
      stepsDone: { type: 'integer', description: 'How many of steps are done (0..steps.length).' },
      verification: { type: 'string', enum: ['proof', 'case', 'independent'], description: 'P2 verification level. proof: run the product and quote it (L0 local edit, no case, no tester). case: proof plus one case when the behaviour is worth pinning (L1). independent: another preset writes and runs the acceptance case against a wrong-product red, and EVERY criterion must be covered by a case (L2, or a risk trigger: contract, data, architecture, security, money, migration, concurrency). Omit it only for a row that predates P2.' },
      criteria: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', description: 'Stable id, for example AC-1 or REQ-12-C01.' }, text: { type: 'string', description: 'One checkable sentence.' } }, additionalProperties: false, description: 'Acceptance criteria with stable ids. A bare string gets AC-n. A case names one by criterionId, and an independent task closes only when every criterion has an acceptable case.' } },
      constraints: { type: 'array', items: { type: 'string' }, description: 'Standing rules the work must obey (no new dependency, no schema change, keep the public CLI).' },
      reviewedTaskIds: { type: 'array', items: { type: 'string' }, description: 'Batch review: the 2-8 task ids ONE review task covers. The reviewer returns a verdict per id and closes none of them; the orchestrator closes each one itself.' },
      caseIds: { type: 'array', items: { type: 'string' }, description: 'The cases this task owes for acceptance (their ids). case_record attaches them automatically; set them here to attach or repair by hand. An empty list means the task owes no case.' },
      chore: { type: 'boolean', description: 'true when the work is justified housekeeping rather than a requirement; needs a non-empty choreReason.' },
      choreReason: { type: 'string', description: 'Why this chore is needed; required with chore:true.' },
    },
    output: out(),
    async execute(args, exec) {
      const cwd = workingDir(exec.agent)
      const task = service.create(cwd, { ...args, parentSessionId: exec.agent?.id, chatId: rootOf(exec.agent?.id) }, 'orchestrator')
      if (task !== undefined && task?.ok !== false) {
        const taskMirror = await service.flushMirror(cwd)
        return { ...task, ...(taskMirror === null ? {} : { taskMirror }) }
      }
      return task
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_get',
    description: 'Read one task in full: objective, scope, non-scope, acceptance, status, result and timeline. Its linked child sessions carry `running` (true/false from the runtime, absent when unknown) and `runningChildSessionIds` names who is working NOW; a task can be active with an idle child, so read these fields rather than inferring activity from the status.',
    parameters: { id: { type: 'string', required: true, description: 'Task id.' } },
    output: out(),
    execute(args, exec) {
      const task = service.get(workingDir(exec.agent), args.id)
      return Promise.resolve(task ?? { ok: false, code: 'not_found' })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_list',
    description: 'List tasks in compact form, one page at a time. The default scope is THIS CHAT only: every chat starts with its own empty board. Pass scope "workspace" to read the workspace history, including other chats and rows from before boards were per-chat - use it when the user asks what has been done before, or before reusing a role name. A workspace list is PAGED because the whole history is tens of thousands of characters: page one carries counts by status, the first `limit` rows and a `next` cursor; ask for the next page with limit/offset instead of reading everything into the step. Each task carries its linked child sessions; children[].running and runningChildSessionIds say which subagents are working NOW (from the runtime), which is NOT the same as the task being active: a task stays active until it is accepted, while its child may be idle or gone.',
    parameters: {
      scope: { type: 'string', enum: ['chat', 'workspace'], description: 'chat (default) lists this chat only; workspace lists the whole workspace history, one page at a time.' },
      status: { type: 'string', description: 'Optional status filter: open | active | review | blocked | paused | done | cancelled.' },
      limit: { type: 'integer', description: 'Rows per page. Default 25 (workspace) or 50 (chat); capped at 200.' },
      offset: { type: 'integer', description: 'Rows to skip; use the next.offset of the previous page.' },
    },
    output: out(),
    execute(args, exec) {
      const all = args.scope === 'workspace'
      const tasks = service.list(workingDir(exec.agent), {
        chatId: rootOf(exec.agent?.id),
        all,
      })
      const status = typeof args.status === 'string' && args.status !== '' ? args.status : ''
      const filtered = status === '' ? tasks : tasks.filter((task) => task.status === status)
      const limit = Math.min(200, Math.max(1, Number.isSafeInteger(args.limit) && args.limit > 0 ? args.limit : (all ? 25 : 50)))
      const offset = Number.isSafeInteger(args.offset) && args.offset > 0 ? args.offset : 0
      const counts = {}
      for (const task of tasks) counts[task.status] = (counts[task.status] ?? 0) + 1
      const page = filtered.slice(offset, offset + limit)
      const nextOffset = offset + page.length
      return Promise.resolve({
        ok: true,
        scope: all ? 'workspace' : 'chat',
        ...(status === '' ? {} : { status }),
        total: filtered.length,
        counts,
        tasks: page,
        ...(nextOffset < filtered.length ? { next: { limit, offset: nextOffset } } : {}),
        ...(nextOffset < filtered.length ? { hint: 'More rows exist; call task_list again with next.limit and next.offset instead of reading everything.' } : {}),
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_update',
    description: 'Compare-and-set one task. Pass the revision you read; a stale revision is rejected with the current task. This is how a human or the orchestrator changes status, scope, non-scope, acceptance or the result summary. With the project-state core mounted the updated task is mirrored into state/task/ and the projections are regenerated.',
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
      reqIds: { type: 'array', items: { type: 'string' }, description: 'Several REQs this task covers; a batch edits the list in place instead of creating another task.' },
      waiver: { type: 'object', additionalProperties: false, description: 'Explicit waiver: {reason, by: "human"} for a lifecycle refusal (steps_incomplete, req_required).', properties: { reason: { type: 'string' }, by: { type: 'string' } } },
      steps: { type: 'array', items: { type: 'string' }, description: 'The steps of the batch, in order.' },
      stepsDone: { type: 'integer', description: 'How many steps are done (0..steps.length); the board shows the progress.' },
      verification: { type: 'string', enum: ['proof', 'case', 'independent'], description: 'P2 verification level. proof: run the product and quote it. case: proof plus one case when worthwhile. independent: every criterion needs another preset to write and run the acceptance case against a wrong-product red. Change it before work starts; the close reads it.' },
      criteria: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, additionalProperties: false, description: 'Acceptance criteria with stable ids; a bare string gets AC-n. An independent task closes only when every criterion is covered by an acceptable case.' } },
      constraints: { type: 'array', items: { type: 'string' }, description: 'Standing rules the work must obey.' },
      reviewedTaskIds: { type: 'array', items: { type: 'string' }, description: 'Batch review: the 2-8 task ids this ONE review task covers.' },
      reviewResults: { type: 'array', items: { type: 'object', properties: { taskId: { type: 'string' }, verdict: { type: 'string', enum: ['pass', 'fail'] }, findings: { type: 'array', items: { type: 'string' } }, evidence: { type: 'array', items: { type: 'string' } } }, additionalProperties: false, description: 'The per-task verdict of a batch review: one entry for every reviewedTaskIds entry. The review task closes only when every reviewed task has a verdict.' } },
      caseIds: { type: 'array', items: { type: 'string' }, description: 'The case ids this task owes for acceptance. Use it to attach a case that case_record could not link (no taskboard mounted at write time) or to detach one. An empty list means the task owes no case.' },
      chore: { type: 'boolean' }, choreReason: { type: 'string' },
      scope: { type: 'string', enum: ['workspace'], description: "'workspace' lets a ROOT agent write a task another chat created (the ledger is one per workspace). Refused for child sessions." },
    },
    output: out(),
    async execute(args, exec) {
      const widened = workspaceScope(args, exec)
      if (widened.refused !== undefined) return Promise.resolve(widened.refused)
      const patch = {}
      for (const key of TASK_UPDATE_FIELDS) {
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
      const cwd = workingDir(exec.agent)
      const result = service.update(cwd, { id: args.id, expectedRevision: args.expectedRevision, patch, scope: widened.scope, chatId: rootOf(exec.agent?.id) })
      if (result !== undefined && result?.ok !== false) {
        const taskMirror = await service.flushMirror(cwd)
        return { ...result, ...(taskMirror === null ? {} : { taskMirror }) }
      }
      return result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_note',
    description: 'Append one note to a task timeline without changing its structured fields.',
    parameters: {
      id: { type: 'string', required: true, description: 'Task id.' },
      text: { type: 'string', required: true, description: 'The note.' },
      scope: { type: 'string', enum: ['workspace'], description: "'workspace' lets a ROOT agent note on a task another chat created (the ledger is one per workspace). Refused for child sessions." },
    },
    output: out(),
    execute(args, exec) {
      const widened = workspaceScope(args, exec)
      if (widened.refused !== undefined) return Promise.resolve(widened.refused)
      return Promise.resolve(service.note(workingDir(exec.agent), { ...args, scope: widened.scope, chatId: rootOf(exec.agent?.id) }))
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
    description: 'Cancel one task or a batch (ids) and interrupt every linked child first. Use it for work that will not be finished: a paused task and a task that still has children can ONLY be abandoned this way (an ordinary update is refused). The reason is recorded as a decision on every result and as a timeline entry. A refused child stop cancels nothing and returns interrupt_failed; a batch reports each row separately and never claims a whole-batch success when one row was refused. done is terminal: an accepted task stays accepted. force:true skips the child interrupt for artifact cleanup when the linked sessions belong to a process that no longer exists.',
    parameters: {
      id: { type: 'string', description: 'Task id for a single cancel.' },
      ids: { type: 'array', items: { type: 'string' }, description: 'Task ids for a batch cancel: one ledger write, per-task results, partial by design.' },
      reason: { type: 'string', description: 'Why the work is being dropped, in one line. Shared by a batch and kept on every result and timeline.' },
      force: { type: 'boolean', description: 'Skip the child interrupt and mark linked children settled; only for a row whose sessions no longer exist (artifact cleanup). The owner asserts the work is dropped.' },
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
    description: 'Apply one JSON operation to the workspace task ledger (used by the Tasks panel and the Project state panel).',
    recordInput: false,
    handler: async (invocation) => {
      let op
      try {
        op = JSON.parse(invocation.rawInput)
      } catch {
        return { kind: 'error', text: 'taskboard: expected a JSON operation' }
      }
      try {
        // `owner-status` mirrors the row and writes the state journal before it answers, so
        // this one op is awaited; the others keep their synchronous result.
        const result = await service.applyOp(workingDir(invocation.agent), op, 'human', invocation.agent?.id)
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
