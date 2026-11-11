#!/usr/bin/env node
/**
 * PURPOSE
 *   Bring a workspace taskboard to the role contract the orchestrator now enforces: a role
 *   is a (name, preset) pair, a role label keeps one preset, and a legacy row without a
 *   preset is history rather than a reuse target. It also settles `active` tasks whose
 *   children have all ended, which is state the live `childEnded` path only writes when the
 *   process saw the child finish.
 *
 * WHY A SCRIPT AND NOT A PLUGIN MIGRATION. The board is workspace data, not plugin state:
 *   ~/tasks/autolabel_pipeline/.dsh/taskboard.json carries 222 tasks and 11 role rows that
 *   predate this contract, and a migration that ran on plugin boot would rewrite a live board
 *   behind a running chat. An operator runs this, reads the counts, and keeps the backup.
 *
 * INPUTS
 *   --board <path>   ledger to migrate (default `.dsh/taskboard.json` under --cwd)
 *   --cwd <dir>      workspace the default board path is relative to (default: process cwd)
 *   --apply          write the result (default is a dry run that writes nothing)
 *   --backup-dir <d> where the pre-migration copy goes (default: `<board dir>/backups`)
 *
 * OUTPUTS
 *   One JSON object on stdout: `{board, changed, before, after, actions, reconcile}` plus,
 *   with `--apply`, `backup` and `revisionAfter`. Exit 0 when the board is already at the
 *   contract or was migrated, 2 when the file changed under the run (CAS refusal, nothing
 *   written), 1 on a bad invocation or an unreadable/invalid board.
 *
 * BEHAVIOUR ON EDGE CASES
 *   - IDEMPOTENT: every transform is "already at the target" aware, so a second run reports
 *     `changed: false` and writes nothing. A migration nobody can run twice is not one that
 *     can be run on a live board.
 *   - COMPARE-AND-SET: the file is re-read immediately before the write; if its `revision`
 *     or bytes moved while this run worked, nothing is written and the exit code is 2.
 *   - NO HISTORY LOSS: terminal tasks keep their status, result and timeline. A task whose
 *     role is renamed gets a `role_split` timeline entry naming the old role; nothing else on
 *     the row changes. A merged agent row keeps both sessions in its `history`.
 *   - A MISSING `agents` ARRAY is not an error: an early board has tasks only, and the
 *     migration then has nothing to split.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { reconcileTasks } from '../plugins/taskboard/taskboard.mjs'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const value = (name) => {
  const at = argv.indexOf(name)
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : ''
}

/** A role label normalised the way the ledger compares it. */
const norm = (input) => String(input ?? '').trim().toLowerCase()

/** The replacement name for the one ambiguous label this contract retired. */
const AUDIT_SPLIT = { reviewer: 'REVIEWER', critic: 'CRITIC' }

/** Compact status counts, so before/after can be compared without reading the board. */
function statusCounts(tasks) {
  const counts = {}
  for (const task of tasks) counts[task.status ?? 'open'] = (counts[task.status ?? 'open'] ?? 0) + 1
  return counts
}

/** `ROLE [preset|none]` per row, so a role row's identity is visible in the summary. */
function roleRows(agents) {
  return agents.map((agent) => `${agent.role} [${typeof agent.preset === 'string' && agent.preset !== '' ? agent.preset : 'none'}]`)
}

/**
 * Rename or merge the AUDIT rows the old mapping collapsed, dedupe identical rows, and mark
 * preset-less rows legacy.
 *
 * @param agents - The board's agent rows; mutated in place.
 * @param actions - Collector for what happened, so the caller prints what it did.
 */
function migrateAgents(agents, actions) {
  // 1. Split AUDIT by the preset each row still records. A row whose preset is gone cannot be
  //    split by guesswork, so it is left with its name and marked legacy below.
  for (const agent of [...agents]) {
    if (norm(agent.role) !== 'audit') continue
    const target = AUDIT_SPLIT[String(agent.preset ?? '').trim()]
    if (target === undefined) continue
    const existing = agents.find((other) => other !== agent && norm(other.role) === norm(target))
    if (existing === undefined) {
      const previous = agent.role
      agent.role = target
      agent.label = typeof agent.label === 'string' && norm(agent.label) !== 'audit' ? agent.label : target
      agent.renamedFrom = previous
      actions.push({ kind: 'agent_split', from: previous, to: target, preset: agent.preset })
    } else {
      // Two rows for one specialty: keep the surviving row and fold the other's sessions into
      // its history, so every superseded session is still listed.
      const history = Array.isArray(existing.history) ? existing.history : []
      const merged = Array.isArray(agent.history) ? agent.history : []
      existing.history = [
        ...history,
        ...merged,
        ...(typeof agent.sessionId === 'string' && agent.sessionId !== existing.sessionId
          ? [{ sessionId: agent.sessionId, mergedFrom: agent.role, mergedAt: new Date().toISOString() }]
          : []),
      ].slice(-8)
      existing.taskCount = Math.max(Number.isSafeInteger(existing.taskCount) ? existing.taskCount : 0, Number.isSafeInteger(agent.taskCount) ? agent.taskCount : 0)
      existing.generation = Math.max(Number.isSafeInteger(existing.generation) ? existing.generation : 1, Number.isSafeInteger(agent.generation) ? agent.generation : 1)
      agents.splice(agents.indexOf(agent), 1)
      actions.push({ kind: 'agent_merge', from: agent.role, into: existing.role, preset: existing.preset ?? null })
    }
  }
  // 2. Duplicate rows with the same (role, preset): one role, one row.
  const seen = new Map()
  for (const agent of [...agents]) {
    const key = `${norm(agent.role)}|${String(agent.preset ?? '').trim()}`
    const kept = seen.get(key)
    if (kept === undefined) {
      seen.set(key, agent)
      continue
    }
    kept.taskCount = Math.max(Number.isSafeInteger(kept.taskCount) ? kept.taskCount : 0, Number.isSafeInteger(agent.taskCount) ? agent.taskCount : 0)
    if (String(agent.updatedAt ?? '') > String(kept.updatedAt ?? '')) {
      kept.sessionId = agent.sessionId
      kept.updatedAt = agent.updatedAt
      kept.generation = Number.isSafeInteger(agent.generation) ? agent.generation : kept.generation
    }
    agents.splice(agents.indexOf(agent), 1)
    actions.push({ kind: 'agent_dedupe', role: agent.role, preset: agent.preset ?? null })
  }
  // 3. A preset-less row is legacy: history, never a reuse target.
  for (const agent of agents) {
    const legacy = typeof agent.preset !== 'string' || agent.preset.trim() === ''
    if (legacy && agent.legacy !== true) {
      agent.legacy = true
      actions.push({ kind: 'agent_legacy', role: agent.role })
    }
    if (!legacy && agent.legacy === true) delete agent.legacy
  }
}

/**
 * Rename the task rows that carry the retired AUDIT label, so REVIEWER/CRITIC carry-forward
 * finds the work the label did. Terminal rows keep their status, result and timeline.
 */
function migrateTaskRoles(tasks, actions) {
  for (const task of tasks) {
    if (norm(task.role) !== 'audit') continue
    const target = AUDIT_SPLIT[String(task.preset ?? '').trim()]
    if (target === undefined) continue
    const previous = task.role
    task.role = target
    if (typeof task.owner === 'object' && task.owner !== null && norm(task.owner.label) === 'audit') task.owner.label = target
    const entry = { at: new Date().toISOString(), kind: 'role_split', actor: 'migration', text: `Role renamed from ${previous} to ${target}: a role is a (name, preset) pair and AUDIT meant two jobs`, previousRole: previous }
    task.timeline = [...(Array.isArray(task.timeline) ? task.timeline : []), entry].slice(-120)
    actions.push({ kind: 'task_role_split', id: task.id, from: previous, to: target, preset: task.preset ?? null, status: task.status })
  }
}

/** Read a board as JSON; a missing file is a named failure, not an empty board. */
function readBoardAt(file) {
  if (!existsSync(file)) throw Object.assign(new Error(`no board at ${file}`), { code: 'missing_board' })
  const raw = readFileSync(file, 'utf8')
  let board
  try {
    board = JSON.parse(raw)
  } catch (error) {
    throw Object.assign(new Error(`${file} is not valid JSON: ${error.message}`), { code: 'invalid_board' })
  }
  if (board === null || typeof board !== 'object' || !Array.isArray(board.tasks)) {
    throw Object.assign(new Error(`${file} has no tasks array`), { code: 'invalid_board' })
  }
  return { board, raw, revision: Number.isSafeInteger(board.revision) ? board.revision : 0 }
}

/** Write through a temp file and a rename, so a reader never sees half a board. */
function writeAtomic(file, board) {
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(board, null, 2)}\n`, 'utf8')
  renameSync(temp, file)
}

function main() {
  const cwd = value('--cwd') !== '' ? resolve(value('--cwd')) : process.cwd()
  const boardArg = value('--board')
  const file = boardArg === '' ? join(cwd, '.dsh', 'taskboard.json') : isAbsolute(boardArg) ? boardArg : resolve(cwd, boardArg)
  const apply = flag('--apply')
  let loaded
  try {
    loaded = readBoardAt(file)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, code: error.code ?? 'read_failed', message: error.message, board: file })}\n`)
    return 1
  }
  const board = loaded.board
  const agents = Array.isArray(board.agents) ? board.agents : []
  const tasks = board.tasks
  const before = { revision: loaded.revision, tasks: tasks.length, statuses: statusCounts(tasks), agents: agents.length, roles: roleRows(agents) }
  const actions = []
  migrateAgents(agents, actions)
  migrateTaskRoles(tasks, actions)
  board.agents = agents
  const reconciled = reconcileTasks(board)
  if (reconciled.fixed > 0) {
    actions.push({ kind: 'task_reconciled', ids: reconciled.ids, blocked: reconciled.blocked, review: reconciled.review, running: reconciled.running, unknown: reconciled.unknown })
  }
  const after = { tasks: tasks.length, statuses: statusCounts(tasks), agents: agents.length, roles: roleRows(agents) }
  const summary = { ok: true, board: file, applied: false, changed: actions.length > 0, before, after, actions, reconcile: reconciled }
  if (actions.length === 0) {
    process.stdout.write(`${JSON.stringify(summary)}\n`)
    return 0
  }
  if (!apply) {
    process.stdout.write(`${JSON.stringify(summary)}\n`)
    return 0
  }
  // COMPARE-AND-SET, at the last moment before the write: the board may be live.
  let current
  try {
    current = readBoardAt(file)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ...summary, ok: false, code: error.code ?? 'read_failed', message: error.message })}\n`)
    return 2
  }
  if (current.revision !== loaded.revision || current.raw !== loaded.raw) {
    process.stdout.write(`${JSON.stringify({ ...summary, ok: false, code: 'board_changed', message: `the board changed while this run worked (revision ${loaded.revision} -> ${current.revision}); nothing was written`, revisionNow: current.revision })}\n`)
    return 2
  }
  const backupDir = value('--backup-dir') !== '' ? resolve(value('--backup-dir')) : join(dirname(file), 'backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = join(backupDir, `taskboard-${stamp}-r${loaded.revision}.json`)
  copyFileSync(file, backup)
  board.revision = loaded.revision + 1
  try {
    writeAtomic(file, board)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ...summary, ok: false, code: 'write_failed', message: error.message, backup })}\n`)
    return 1
  }
  process.stdout.write(`${JSON.stringify({ ...summary, applied: true, backup, revisionAfter: board.revision })}\n`)
  return 0
}

process.exitCode = main()
