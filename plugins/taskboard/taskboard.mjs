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
 * INPUTS
 *   Config (all optional):
 *     file     ledger path relative to the session workspace. Default `.dsh/taskboard.json`.
 *     maxTasks maximum retained tasks. Default 200.
 *     timelineLimit maximum timeline entries per task. Default 120.
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
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** Ledger format version. A different version is refused, never reinterpreted. */
const BOARD_VERSION = 1

const STATUSES = ['proposed', 'ready', 'active', 'paused', 'review', 'done', 'blocked', 'cancelled']
const PRIORITIES = ['low', 'normal', 'high']
const EDITABLE_STATUSES = ['proposed', 'ready', 'active', 'review', 'blocked', 'cancelled']

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

/** A status the schema accepts, or `proposed`. */
function statusOf(value, fallback = 'proposed') {
  return STATUSES.includes(value) ? value : fallback
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

/**
 * Build the ledger service.
 *
 * @param config - Raw plugin config.
 * @param logger - Cordis logger, for the one warning the service emits.
 * @returns The service placed on `ctx.taskboard`.
 */
function createService(config, logger, hooks = {}) {
  const file = typeof config.file === 'string' && config.file !== '' ? config.file : '.dsh/taskboard.json'
  const maxTasks = Number.isSafeInteger(config.maxTasks) && config.maxTasks > 0 ? config.maxTasks : 200
  const timelineLimit = Number.isSafeInteger(config.timelineLimit) && config.timelineLimit > 0 ? config.timelineLimit : 120
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

  /** Compact list row; the board UI uses the full task document. */
  const summary = (task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    role: task.role ?? null,
    priority: task.priority,
    owner: task.owner?.label ?? null,
    childSessionIds: task.childSessionIds ?? [],
    children: Array.isArray(task.children) ? task.children : [],
    revision: task.revision,
    updatedAt: task.updatedAt,
  })

  return {
    file,
    pathFor,
    /** The whole board for one session workspace. */
    list(cwd) {
      return readBoard(pathFor(cwd)).tasks.map(summary)
    },
    /** Persistent specialists for one workspace. */
    agents(cwd) {
      return readBoard(pathFor(cwd)).agents ?? []
    },
    /** Find one persistent specialist by role (case-insensitive). */
    findAgent(cwd, role) {
      const wanted = typeof role === 'string' ? role.trim().toLowerCase() : ''
      if (wanted === '') return undefined
      return (readBoard(pathFor(cwd)).agents ?? []).find((agent) => agent.role.trim().toLowerCase() === wanted)
    },
    /** Create or update a persistent specialist role and its child session. */
    registerAgent(cwd, input) {
      const role = typeof input?.role === 'string' ? input.role.trim().slice(0, 80) : ''
      const sessionId = typeof input?.sessionId === 'string' ? input.sessionId : ''
      if (role === '' || sessionId === '') return { ok: false, code: 'invalid_agent' }
      const label = typeof input?.label === 'string' && input.label !== '' ? input.label.slice(0, 200) : role
      return mutate(cwd, (board) => {
        const agents = Array.isArray(board.agents) ? board.agents : []
        const existing = agents.find((agent) => agent.role.trim().toLowerCase() === role.toLowerCase())
        const time = now()
        if (existing === undefined) {
          agents.push({ role, label, sessionId, status: 'active', taskCount: 1, lastTaskId: input?.taskId ?? null, createdAt: time, updatedAt: time })
        } else {
          existing.label = label
          existing.sessionId = sessionId
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
    /** Create a task; returns the full record. */
    create(cwd, input, actor = 'orchestrator') {
      const title = typeof input?.title === 'string' ? input.title.trim() : ''
      if (title === '') throw new Error('taskboard: a task needs a non-empty title')
      return mutate(cwd, (board) => {
        const time = now()
        if (board.tasks.length >= maxTasks) return { value: { ok: false, code: 'board_full' } }
        const task = {
          id: taskId(),
          revision: 1,
          title: title.slice(0, 200),
          objective: typeof input?.objective === 'string' ? input.objective.slice(0, 4000) : '',
          scope: strings(input?.scope),
          nonScope: strings(input?.nonScope),
          acceptance: acceptance(input?.acceptance),
          status: statusOf(input?.status, 'proposed'),
          priority: priorityOf(input?.priority),
          ...(typeof input?.role === 'string' && input.role.trim() !== '' ? { role: input.role.trim().slice(0, 80) } : {}),
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
        timeline(task, 'created', actor, `Created: ${task.title}`, {}, timelineLimit)
        board.tasks.push(task)
        return { changed: true, value: task }
      })
    },
    /** Compare-and-set update; a stale revision returns the current task untouched. */
    update(cwd, input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const expected = Number.isSafeInteger(input?.expectedRevision) ? input.expectedRevision : null
      return mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        if (expected !== null && task.revision !== expected) {
          return { value: { ok: false, code: 'stale', task } }
        }
        const patch = input?.patch !== null && typeof input?.patch === 'object' ? input.patch : input
        if (patch.status === 'paused' && task.status !== 'paused') return { value: { ok: false, code: 'use_pause', task } }
        if (patch.status === 'done' && task.status !== 'done') return { value: { ok: false, code: 'use_close', task } }
        if (task.status === 'paused' && patch.status !== 'paused') return { value: { ok: false, code: 'use_resume', task } }
        if (patch.status === 'cancelled' && task.status !== 'cancelled' && task.childSessionIds.length > 0) return { value: { ok: false, code: 'use_close', task } }
        if (typeof patch.title === 'string' && patch.title.trim() === '') return { value: { ok: false, code: 'empty_title', task } }
        const before = JSON.stringify(task)
        if (typeof patch.title === 'string' && patch.title.trim() !== '') task.title = patch.title.trim().slice(0, 200)
        if (typeof patch.objective === 'string') task.objective = patch.objective.slice(0, 4000)
        if (Array.isArray(patch.scope)) task.scope = strings(patch.scope)
        if (Array.isArray(patch.nonScope)) task.nonScope = strings(patch.nonScope)
        if (Array.isArray(patch.acceptance)) task.acceptance = acceptance(patch.acceptance, task.acceptance)
        if (patch.status !== undefined) task.status = statusOf(patch.status, task.status)
        if (patch.priority !== undefined) task.priority = priorityOf(patch.priority)
        if (patch.owner !== undefined && patch.owner !== null && typeof patch.owner === 'object') {
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
      if (text === '') return { ok: false, code: 'empty' }
      return mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
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
      if (childId === '') return { ok: false, code: 'empty' }
      return mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        if (!task.childSessionIds.includes(childId)) task.childSessionIds.push(childId)
        if (!['done', 'cancelled', 'paused'].includes(task.status)) task.status = 'active'
        const agent = (board.agents ?? []).find((entry) => entry.sessionId === childId)
        const label = typeof input?.label === 'string' && input.label !== '' ? input.label.slice(0, 200) : (agent?.label ?? 'child')
        const role = typeof input?.role === 'string' && input.role !== '' ? input.role.slice(0, 200) : (agent?.role ?? label)
        const children = Array.isArray(task.children) ? task.children : []
        const existing = children.find((child) => child.sessionId === childId)
        if (existing === undefined) children.push({ sessionId: childId, label, role, status: 'active', startedAt: now(), endedAt: null })
        else Object.assign(existing, { label, role, status: 'active', endedAt: null })
        task.children = children
        task.owner = { kind: 'agent', label, sessionId: childId }
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
          task.status = ['cancelled', 'paused', 'done'].includes(task.status) ? task.status : stillRunning ? 'active' : 'review'
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
      return mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        if (task.status === 'done' || task.status === 'cancelled') return { value: { ok: false, code: 'closed', task } }
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
      return mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        if (task.status !== 'paused') return { value: { ok: false, code: 'not_paused', task } }
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
    /** Close a task as done and interrupt its linked children; fail closed. */
    close(cwd, input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const requestedParent = typeof input?.parentSessionId === 'string' && input.parentSessionId !== '' ? input.parentSessionId : ''
      return mutate(cwd, (board) => {
        const task = board.tasks.find((entry) => entry.id === id)
        if (task === undefined) return { value: { ok: false, code: 'not_found' } }
        if (task.status === 'cancelled') return { value: { ok: false, code: 'cancelled', task } }
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
      return mutate(cwd, (board) => {
        const index = board.tasks.findIndex((entry) => entry.id === id)
        if (index === -1) return { value: { ok: false, code: 'not_found' } }
        const [task] = board.tasks.splice(index, 1)
        for (const childId of task.childSessionIds ?? []) {
          const links = (childLinks.get(childId) ?? []).filter((entry) => !(entry.cwd === cwd && entry.id === id))
          if (links.length === 0) childLinks.delete(childId)
          else childLinks.set(childId, links)
        }
        writeLinks(childLinks)
        return { changed: true, value: { ok: true, removed: true, id, task } }
      })
    },
    /** The one operation shape the UI command uses. */
    applyOp(cwd, op, actor = 'human', actorSessionId = '') {
      if (op === null || typeof op !== 'object') return { ok: false, code: 'invalid' }
      const kind = op.op
      if (kind === 'create') return { ok: true, task: this.create(cwd, { ...(op.task ?? op), parentSessionId: actorSessionId }, actor) }
      if (kind === 'update') return this.update(cwd, { ...op, actor })
      if (kind === 'note') return this.note(cwd, { ...op, actor })
      if (kind === 'link') return this.linkChild(cwd, op)
      if (kind === 'pause') return this.pause(cwd, { ...op, parentSessionId: actorSessionId, actor })
      if (kind === 'resume') return this.resume(cwd, { ...op, actor })
      if (kind === 'close') return this.close(cwd, { ...op, parentSessionId: actorSessionId, actor })
      if (kind === 'remove') return this.remove(cwd, op)
      if (kind === 'get') return { ok: true, task: this.get(cwd, op.id) }
      if (kind === 'list') return { ok: true, tasks: this.list(cwd) }
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
  const service = createService(config, ctx.logger, {
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
    description: 'Create one workspace task with an objective, scope, non-scope and acceptance. The taskboard is the workspace ledger for work in flight: open a task for EVERY change you make, whether you do it inline or delegate it, and keep it moving through proposed/ready/active/review/done. Delegation is one way to run a task, not the reason to create one. Returns the full task, including its id and revision.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short task title.' },
      objective: { type: 'string', description: 'The outcome in one paragraph.' },
      scope: { type: 'array', items: { type: 'string' }, description: 'What the work may touch.' },
      nonScope: { type: 'array', items: { type: 'string' }, description: 'What the work must not touch, with the reason.' },
      acceptance: { type: 'array', items: { type: 'string' }, description: 'How the orchestrator will judge the result.' },
      parentId: { type: 'string', description: 'Optional parent task id.' },
      priority: { type: 'string', enum: PRIORITIES, description: 'low | normal | high.' },
    },
    output: out(),
    execute(args, exec) {
      const task = service.create(workingDir(exec.agent), { ...args, parentSessionId: exec.agent?.id }, 'orchestrator')
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
    description: 'List the workspace task ledger in compact form. Use it before delegating and before claiming a task is done.',
    parameters: {},
    output: out(),
    execute(_args, exec) {
      return Promise.resolve(service.list(workingDir(exec.agent)))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_update',
    description: 'Compare-and-set one task. Pass the revision you read; a stale revision is rejected with the current task. This is how a human or the orchestrator changes status, scope, non-scope, acceptance or the result summary.',
    parameters: {
      id: { type: 'string', required: true, description: 'Task id.' },
      expectedRevision: { type: 'integer', required: true, description: 'Task revision you read.' },
      status: { type: 'string', enum: EDITABLE_STATUSES, description: 'New status. Use task_pause/task_resume/task_close for paused/done.' },
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
      for (const key of ['status', 'title', 'objective', 'scope', 'nonScope', 'acceptance', 'priority']) {
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
      const result = service.update(workingDir(exec.agent), { id: args.id, expectedRevision: args.expectedRevision, patch })
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
      return Promise.resolve(service.note(workingDir(exec.agent), args))
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
      return Promise.resolve(service.linkChild(workingDir(exec.agent), args))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_pause',
    description: 'Pause a task and interrupt its linked child sessions. The task moves to paused; the return lists the interrupted children and any errors. A child that has already settled is an accepted no-op.',
    parameters: { id: { type: 'string', required: true, description: 'Task id.' } },
    output: out(),
    execute(args, exec) {
      return Promise.resolve(service.pause(workingDir(exec.agent), { id: args.id, parentSessionId: exec.agent?.id, actor: 'orchestrator' }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_resume',
    description: 'Move a paused task back to active. It does not auto-prompt the child; open the child session to continue the interrupted turn.',
    parameters: { id: { type: 'string', required: true, description: 'Task id.' } },
    output: out(),
    execute(args, exec) {
      return Promise.resolve(service.resume(workingDir(exec.agent), { id: args.id, actor: 'orchestrator' }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_close',
    description: 'Close a task as done and best-effort interrupt its linked child sessions. Use this for a deliberate acceptance or abandonment; child sessions remain available.',
    parameters: { id: { type: 'string', required: true, description: 'Task id.' } },
    output: out(),
    execute(args, exec) {
      return Promise.resolve(service.close(workingDir(exec.agent), { id: args.id, parentSessionId: exec.agent?.id, actor: 'orchestrator' }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_remove',
    description: 'Remove a task from the workspace ledger. The task and its timeline are deleted; linked child sessions are deliberately left running, so pause or close first if they should stop.',
    parameters: { id: { type: 'string', required: true, description: 'Task id.' } },
    output: out(),
    execute(args, exec) {
      return Promise.resolve(service.remove(workingDir(exec.agent), { id: args.id }))
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
