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
    if (typeof result?.summary !== 'string' || result.summary.trim() === '') return 'needs_result'
    if (!Array.isArray(result?.evidence) || result.evidence.length === 0) return 'needs_evidence'
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
  return (Array.isArray(board?.agents) ? board.agents : []).map((agent) => {
    const lastTaskId = typeof agent.lastTaskId === 'string' ? agent.lastTaskId : ''
    const orphan = lastTaskId !== '' && !ids.has(lastTaskId)
    const updated = Date.parse(String(agent.updatedAt ?? agent.createdAt ?? ''))
    const stale = Number.isNaN(updated) ? false : nowMs - updated > staleAfterMs
    return {
      ...agent,
      ...(orphan ? { orphan: true } : {}),
      ...(stale ? { stale: true } : {}),
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
      return mutate(cwd, (board) => {
        const agents = Array.isArray(board.agents) ? board.agents : []
        const existing = agents.find((agent) => agent.role.trim().toLowerCase() === role.toLowerCase())
        const time = now()
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
          if (preset !== '') existing.preset = preset
          if (chatSessionId !== '') existing.chatSessionId = chatSessionId
          existing.status = 'active'
          existing.updatedAt = time
          if (typeof input?.taskId === 'string' && input.taskId !== '' && input.taskId !== existing.lastTaskId) {
            existing.lastTaskId = input.taskId
            existing.taskCount = Number.isSafeInteger(existing.taskCount) ? existing.taskCount + 1 : 1
          }
        }
        board.agents = agents
        return { changed: true, value: { ok: true, agent: agents.find((agent) => agent.role.trim().toLowerCase() === role.toLowerCase()) } }
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
          const nowStatus = displayStatus(task.status)
          task.status = ['cancelled', 'paused', 'done'].includes(nowStatus) ? task.status : stillRunning ? 'active' : 'review'
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
          timeline(task, 'child_finished', 'child', `Child settled (${info?.stopReason ?? 'unknown'})${output === '' ? '' : `: ${output}`}`, { sessionId: childId }, timelineLimit)
          return { changed: true, value: { ok: true, task } }
        })
        if (result !== undefined) last = result
      }
      return last
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
        const parentSessionId = typeof task.parentSessionId === 'string' && task.parentSessionId !== '' ? task.parentSessionId : requestedParent
        const interrupted = []
        const errors = []
        const children = Array.isArray(task.children) ? task.children : []
        for (const childId of task.childSessionIds) {
          const child = children.find((entry) => entry.sessionId === childId)
          if (typeof hooks.interrupt !== 'function') {
            errors.push(`${childId}: subagent service is unavailable`)
            continue
          }
          try {
            hooks.interrupt(childId, parentSessionId)
            interrupted.push(childId)
            if (child !== undefined) child.status = 'paused'
            const agent = (board.agents ?? []).find((entry) => entry.sessionId === childId)
            if (agent !== undefined) { agent.status = 'paused'; agent.updatedAt = now() }
          } catch (error) {
            errors.push(`${childId}: ${error.message}`)
            if (child !== undefined) child.status = 'sleeping'
          }
        }
        if (errors.length > 0) return { value: { ok: false, code: 'interrupt_failed', task, interrupted, errors } }
        task.children = children
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
      const requestedParent = typeof input?.parentSessionId === 'string' && input.parentSessionId !== '' ? input.parentSessionId : ''
      const chatId = typeof input?.chatId === 'string' ? input.chatId : ''
      const reason = typeof input?.reason === 'string' ? input.reason.trim().slice(0, 1000) : ''
      return mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        if (!writable(task, chatId, input?.actor)) return otherChat(task)
        const from = displayStatus(task.status)
        if (from === 'cancelled') return { value: { ok: true, task, note: 'already cancelled' } }
        // done is the one accepted state: abandoning it would reopen an acceptance.
        if (from === 'done') return { value: { ok: false, code: 'terminal', task } }
        const parentSessionId = typeof task.parentSessionId === 'string' && task.parentSessionId !== '' ? task.parentSessionId : requestedParent
        const interrupted = []
        const errors = []
        const children = Array.isArray(task.children) ? task.children : []
        for (const childId of task.childSessionIds) {
          const child = children.find((entry) => entry.sessionId === childId)
          if (typeof hooks.interrupt !== 'function') { errors.push(`${childId}: subagent service is unavailable`); continue }
          try {
            hooks.interrupt(childId, parentSessionId)
            interrupted.push(childId)
            if (child !== undefined) child.status = 'sleeping'
            const agent = (board.agents ?? []).find((entry) => entry.sessionId === childId)
            if (agent !== undefined) { agent.status = 'sleeping'; agent.updatedAt = now() }
          } catch (error) {
            errors.push(`${childId}: ${error.message}`)
            if (child !== undefined) child.status = 'sleeping'
          }
        }
        if (errors.length > 0) return { value: { ok: false, code: 'interrupt_failed', task, interrupted, errors } }
        task.children = children
        task.status = 'cancelled'
        // The result note says WHY the work was dropped, so a cancelled task is not a silent
        // grave: it appends to the decisions the result already carries and never rewrites a
        // summary somebody wrote.
        const note = reason === '' ? 'Cancelled with no reason given' : `Cancelled: ${reason}`
        const result = resultOf({ decisions: [note] }, task.result)
        if (result !== undefined) task.result = result
        task.revision += 1
        task.updatedAt = now()
        timeline(task, 'cancelled', input?.actor === 'human' ? 'human' : 'orchestrator', note, { sessionIds: interrupted }, timelineLimit)
        return { changed: true, value: { ok: true, task, interrupted, errors, note } }
      })
    },
    /** Close a task as done and interrupt its linked children; fail closed. */
    close(cwd, input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const requestedParent = typeof input?.parentSessionId === 'string' && input.parentSessionId !== '' ? input.parentSessionId : ''
      const chatId = typeof input?.chatId === 'string' ? input.chatId : ''
      return mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        if (!writable(task, chatId, input?.actor)) return otherChat(task)
        const from = displayStatus(task.status)
        if (from === 'cancelled') return { value: { ok: false, code: 'cancelled', task } }
        if (from === 'done') return { value: { ok: true, task } }
        // ACCEPTANCE IS THE ONLY DOOR TO `done`. A task closes from review, which means a
        // result was claimed and the evidence examined; an open or active task is cancelled
        // instead of being declared accepted, and a blocked one is unblocked first.
        if (from !== 'review') return { value: { ok: false, code: 'needs_review', task } }
        // THE CHILD-SETTLE SIGNAL IS NOT AN ACCEPTANCE. A linked child ending still moves the
        // task to review (that is the runtime reporting work finished), but the task only
        // closes once somebody wrote down what was achieved: the orchestrator supplies the
        // result, then accepts.
        if (typeof task.result?.summary !== 'string' || task.result.summary.trim() === '') {
          return { value: { ok: false, code: 'needs_result', task } }
        }
        const parentSessionId = typeof task.parentSessionId === 'string' && task.parentSessionId !== '' ? task.parentSessionId : requestedParent
        const interrupted = []
        const errors = []
        const children = Array.isArray(task.children) ? task.children : []
        for (const childId of task.childSessionIds) {
          const child = children.find((entry) => entry.sessionId === childId)
          if (typeof hooks.interrupt !== 'function') { errors.push(`${childId}: subagent service is unavailable`); continue }
          try {
            hooks.interrupt(childId, parentSessionId)
            interrupted.push(childId)
            if (child !== undefined) child.status = 'sleeping'
            const agent = (board.agents ?? []).find((entry) => entry.sessionId === childId)
            if (agent !== undefined) { agent.status = 'sleeping'; agent.updatedAt = now() }
          } catch (error) {
            errors.push(`${childId}: ${error.message}`)
            if (child !== undefined) child.status = 'sleeping'
          }
        }
        if (errors.length > 0) return { value: { ok: false, code: 'interrupt_failed', task, interrupted, errors } }
        task.children = children
        task.status = 'done'
        task.revision += 1
        task.updatedAt = now()
        timeline(task, 'closed', input?.actor === 'human' ? 'human' : 'orchestrator', 'Closed as done', { sessionIds: interrupted }, timelineLimit)
        return { changed: true, value: { ok: true, task, interrupted, errors } }
      })
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
      if (kind === 'remove') return this.remove(cwd, { ...op, chatId, actor })
      if (kind === 'get') return { ok: true, task: this.get(cwd, op.id) }
      if (kind === 'list') return { ok: true, tasks: this.list(cwd, { chatId, all: op.all === true }) }
      if (kind === 'agents') return { ok: true, agents: this.agents(cwd) }
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
      const parent = ctx.get('agents')?.get(parentSessionId)
      subagents.interrupt(childId, parent === undefined ? { kind: 'user', parentSessionId } : parent)
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
    description: 'Cancel a task and best-effort interrupt its linked child sessions. Use it for work that will not be finished: a paused task and a task that still has children can ONLY be abandoned this way (an ordinary update is refused). The reason is recorded as a decision on the result and as a timeline entry. done is not cancellable (terminal): an accepted task stays accepted.',
    parameters: {
      id: { type: 'string', required: true, description: 'Task id.' },
      reason: { type: 'string', description: 'Why the work is being dropped, in one line. It is kept on the result decisions and the timeline.' },
    },
    output: out(),
    execute(args, exec) {
      return Promise.resolve(service.cancel(workingDir(exec.agent), { ...args, parentSessionId: exec.agent?.id, chatId: rootOf(exec.agent?.id), actor: 'orchestrator' }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_close',
    description: 'Close a task as done and best-effort interrupt its linked child sessions. Use this for a deliberate acceptance or abandonment; child sessions remain available.',
    parameters: { id: { type: 'string', required: true, description: 'Task id.' } },
    output: out(),
    execute(args, exec) {
      return Promise.resolve(service.close(workingDir(exec.agent), { id: args.id, parentSessionId: exec.agent?.id, chatId: rootOf(exec.agent?.id), actor: 'orchestrator' }))
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
