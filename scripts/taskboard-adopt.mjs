/**
 * PURPOSE
 *   Find the TASKs of the register whose row is missing from the taskboard, and (with --write)
 *   create those rows from the TASK itself, so the owner's manual status control works again.
 *
 * WHY THIS EXISTS
 *   `state/task/<id>.md` carries `boardId`, the row the board owns. A TASK written before the
 *   current ledger, or by a writer that lost its row, points at an id the board no longer has:
 *   `/taskboard {"op":"get"}` answers `not_found`, and the panel refuses with `no_board_row`
 *   (observed 2026-11-28 on TASK-383, TASK-372, TASK-337). The register is not rewritten and no
 *   revision is invented: the missing row is created again from the TASK, at revision 1, through
 *   the same journal and lock the board writes with.
 *
 * INPUTS
 *   --report (default) print what would be adopted; nothing is written.
 *   --write            adopt the missing rows: one journal record, one snapshot, one export.
 *   --cwd <dir>        workspace root. Default: the process directory.
 *   --board <file>     ledger path relative to the workspace. Default .dsh/taskboard.json.
 *   --state <dir>      register directory relative to the workspace. Default state.
 *   --only-open        repair only the TASKs whose work is not over (open, active, blocked,
 *                      review); the finished ones are reported and left alone.
 *   --json             print the report as JSON.
 *
 * OUTPUTS
 *   One line per TASK without a row (task id, boardId, status, owner, role, dependencies,
 *   title), the totals, and on --write the adopted ids. Exit 0 when the run did what was asked,
 *   1 when a board write was refused, 2 on a usage error.
 *
 * IDEMPOTENT
 *   A second run finds every adopted row present and writes nothing: the absence check runs
 *   again inside the lock, and an empty set appends no record.
 *
 * KEYWORDS
 *   taskboard, adopt, boardId, orphan row, panel, owner-status, journal, state register
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { createStore } from '../plugins/taskboard/lib/store.mjs'
import { parse } from '../plugins/project-state/lib/format.mjs'

/** The same wait and stale window the board uses for its lock (plugins/taskboard/taskboard.mjs). */
const LOCK_WAIT_MS = 10000
const LOCK_STALE_MS = 30000
const LOCK_POLL_MS = 25

/** The statuses a board row may store; the register's own values are all of them. */
const BOARD_STATUSES = ['open', 'active', 'review', 'blocked', 'done', 'cancelled']

/** Statuses whose work is over: a missing row for one of these is history, not a blocked owner. */
const CLOSED_STATUSES = ['done', 'cancelled']

function usage(message) {
  if (message !== undefined) process.stderr.write(`taskboard-adopt: ${message}\n`)
  process.stderr.write('usage: node scripts/taskboard-adopt.mjs [--report|--write] [--cwd <dir>] [--board <file>] [--state <dir>] [--json]\n')
  process.exit(2)
}

function parseArgs(argv) {
  const options = { write: false, openOnly: false, cwd: process.cwd(), board: '.dsh/taskboard.json', state: 'state', json: false }
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at]
    if (arg === '--write') options.write = true
    else if (arg === '--report') options.write = false
    else if (arg === '--json') options.json = true
    else if (arg === '--only-open') options.openOnly = true
    else if (arg === '--cwd' || arg === '--board' || arg === '--state') {
      const value = argv[at + 1]
      if (value === undefined || value.startsWith('--')) usage(`${arg} needs a value`)
      options[arg.slice(2)] = value
      at += 1
    } else usage(`unknown argument ${arg}`)
  }
  return options
}

/** The TASK files of the register: their frontmatter and body, keyed by id. */
function readRegister(stateDir) {
  const dir = join(stateDir, 'task')
  if (!existsSync(dir)) return []
  const entries = []
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.md')) continue
    let parsed
    try {
      parsed = parse(readFileSync(join(dir, name), 'utf8'))
    } catch (error) {
      entries.push({ id: name.replace(/\.md$/, ''), error: error.message })
      continue
    }
    const fm = parsed.frontmatter ?? {}
    entries.push({
      id: String(fm.id ?? name.replace(/\.md$/, '')),
      boardId: typeof fm.boardId === 'string' ? fm.boardId.trim() : '',
      frontmatter: fm,
      body: typeof parsed.body === 'string' ? parsed.body : '',
    })
  }
  return entries
}

const asStrings = (value) => (Array.isArray(value) ? value.map((item) => String(item).trim()).filter((item) => item !== '') : [])

/**
 * A board row for one TASK, at revision 1.
 *
 * The fields are the TASK's own, in the shape the mirror writes back (plugins/taskboard/mirror.mjs,
 * taskPayload), so the first status change does not empty the register: the mirror reads the row
 * and writes the TASK from it.
 */
function rowFromTask(entry, at) {
  const fm = entry.frontmatter
  const status = BOARD_STATUSES.includes(fm.status) ? fm.status : 'open'
  const owner = fm.owner !== null && typeof fm.owner === 'object' && typeof fm.owner.label === 'string' && fm.owner.label.trim() !== ''
    ? { kind: fm.owner.kind === 'human' ? 'human' : 'agent', label: fm.owner.label.trim() }
    : undefined
  const role = typeof fm.role === 'string' && fm.role.trim() !== '' ? fm.role.trim() : (owner?.label ?? '')
  const reqIds = asStrings(fm.reqIds)
  const reqId = typeof fm.reqId === 'string' && fm.reqId.trim() !== '' ? fm.reqId.trim() : (reqIds[0] ?? '')
  const acceptance = (Array.isArray(fm.acceptance) ? fm.acceptance : [])
    .map((item) => (typeof item === 'string' ? { text: item.trim(), done: false } : { text: String(item?.text ?? '').trim(), done: item?.done === true }))
    .filter((item) => item.text !== '')
  const result = fm.result !== null && typeof fm.result === 'object' ? fm.result : {}
  // THE CHILD SESSIONS TRAVEL WITH THE ROW, or the first mirror after an adoption clears the
  // TASK's `sessions:` block: the mirror writes the register FROM the row (taskSpecifics reads
  // childSessionIds and children[]), so an adopted row that names none erases the link.
  const sessions = (Array.isArray(fm.sessions) ? fm.sessions : [])
    .filter((item) => item !== null && typeof item === 'object' && typeof item.sessionId === 'string' && item.sessionId !== '')
  return {
    id: entry.boardId,
    revision: 1,
    title: String(fm.title ?? entry.id).slice(0, 200),
    objective: entry.body.trim(),
    scope: asStrings(fm.scope),
    nonScope: asStrings(fm.nonScope),
    acceptance,
    status,
    priority: typeof fm.priority === 'string' && fm.priority !== '' ? fm.priority : 'normal',
    ...(role === '' ? { inline: true } : { role }),
    ...(owner === undefined ? {} : { owner }),
    ...(typeof fm.preset === 'string' && fm.preset.trim() !== '' ? { preset: fm.preset.trim() } : {}),
    ...(reqId === '' ? {} : { reqId }),
    reqIds: reqIds.length > 0 ? reqIds : (reqId === '' ? [] : [reqId]),
    caseIds: asStrings(fm.caseIds),
    dependsOn: asStrings(fm.dependsOn),
    steps: asStrings(fm.steps),
    stepsDone: Number.isSafeInteger(fm.stepsDone) ? fm.stepsDone : 0,
    ...(typeof fm.chatId === 'string' && fm.chatId !== '' ? { chatId: fm.chatId } : {}),
    ...(fm.chore === true ? { chore: true } : {}),
    ...(typeof fm.choreReason === 'string' && fm.choreReason.trim() !== '' ? { choreReason: fm.choreReason.trim() } : {}),
    ...(Object.keys(result).length === 0 ? {} : { result }),
    childSessionIds: sessions.map((session) => session.sessionId),
    ...(sessions.length === 0 ? {} : { children: sessions.map((session) => ({ ...session })) }),
    createdAt: typeof fm.createdAt === 'string' ? fm.createdAt : at,
    updatedAt: at,
    timeline: [{ at, kind: 'adopted', actor: 'human', text: `Row adopted from the TASK register (${entry.id}): the board carried no row for ${entry.boardId}` }],
  }
}

/**
 * Hold the board's lock for the duration of one write.
 *
 * The plugin's helper is not exported, so the same lock directory, the same stale takeover and
 * the same wait are repeated here: `<board>.lock` as a directory, removed in a finally block.
 */
function withBoardLock(path, operation) {
  const lock = `${path}.lock`
  mkdirSync(dirname(path), { recursive: true })
  const started = Date.now()
  for (;;) {
    try {
      mkdirSync(lock)
      break
    } catch (error) {
      if (error?.code !== 'EEXIST' && error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error
      let age = 0
      try {
        age = Date.now() - statSync(lock).mtimeMs
      } catch {
        continue
      }
      if (age > LOCK_STALE_MS) {
        try {
          rmdirSync(lock)
        } catch {
          // Somebody else took it over first; the next attempt sees their lock.
        }
        continue
      }
      if (Date.now() - started >= LOCK_WAIT_MS) throw new Error(`timed out after ${LOCK_WAIT_MS} ms waiting for ${lock}`)
      const until = Date.now() + LOCK_POLL_MS
      while (Date.now() < until) { /* the board's own poll: a short sleep without a timer */ }
    }
  }
  try {
    return operation()
  } finally {
    try {
      rmdirSync(lock)
    } catch {
      // Released already.
    }
  }
}

function orphansOf(register, board, openOnly = false) {
  const present = new Set((Array.isArray(board?.tasks) ? board.tasks : []).map((task) => task?.id))
  return register.filter((entry) => entry.boardId !== ''
    && !present.has(entry.boardId)
    && (openOnly !== true || !CLOSED_STATUSES.includes(entry.frontmatter?.status)))
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const cwd = resolve(options.cwd)
  const boardPath = isAbsolute(options.board) ? options.board : resolve(cwd, options.board)
  const stateDir = isAbsolute(options.state) ? options.state : resolve(cwd, options.state)
  if (!existsSync(boardPath)) usage(`no ledger at ${boardPath}`)
  const warnings = []
  const store = createStore({ boardPath, logger: { warn: (message) => warnings.push(message) } })
  const state = store.load()
  const register = readRegister(stateDir)
  const broken = register.filter((entry) => entry.error !== undefined)
  // --only-open is the targeted repair: a finished TASK needs no row for its owner to move it,
  // and adopting 380 of them would grow the ledger without giving the owner anything back.
  const orphans = orphansOf(register, state.board, options.openOnly)

  if (options.json) {
    const open = orphans.filter((entry) => !CLOSED_STATUSES.includes(entry.frontmatter?.status))
    process.stdout.write(`${JSON.stringify({ board: boardPath, revision: state.board.revision, rows: state.board.tasks.length, tasks: register.length, orphans: orphans.map((entry) => ({ id: entry.id, boardId: entry.boardId, status: entry.frontmatter?.status ?? '', title: entry.frontmatter?.title ?? '', owner: entry.frontmatter?.owner?.label ?? '', role: entry.frontmatter?.role ?? '', dependsOn: asStrings(entry.frontmatter?.dependsOn) })), open: open.length, closed: orphans.length - open.length, broken: broken.map((entry) => ({ id: entry.id, error: entry.error })) }, null, 2)}\n`)
  } else {
    process.stdout.write(`ledger ${boardPath} at revision ${state.board.revision}, ${state.board.tasks.length} rows; register ${register.length} TASKs, ${orphans.length} without a row\n`)
    for (const entry of orphans) {
      const fm = entry.frontmatter ?? {}
      const dependsOn = asStrings(fm.dependsOn)
      process.stdout.write(`  ${entry.id}  boardId ${entry.boardId}  status ${fm.status ?? '?'}  owner ${fm.owner?.label ?? '-'}  role ${fm.role ?? '-'}  dependsOn ${dependsOn.length === 0 ? '-' : dependsOn.join(',')}  ${String(fm.title ?? '').slice(0, 70)}\n`)
    }
    for (const entry of broken) process.stdout.write(`  ${entry.id}  UNREADABLE: ${entry.error}\n`)
  }

  const open = orphans.filter((entry) => !CLOSED_STATUSES.includes(entry.frontmatter?.status))
  const closed = orphans.length - open.length
  if (!options.write) {
    if (!options.json) process.stdout.write(`report only: ${orphans.length} row(s) would be adopted from their TASK (${open.length} open work, ${closed} finished); nothing written\n`)
    return 0
  }

  let adopted = []
  withBoardLock(boardPath, () => {
    const locked = createStore({ boardPath, logger: { warn: (message) => warnings.push(message) } })
    const current = locked.load()
    const missing = orphansOf(register, current.board, options.openOnly)
    if (missing.length === 0) {
      process.stdout.write('write: every register TASK already has a row; nothing to append\n')
      return
    }
    const at = new Date().toISOString()
    const rows = missing.map((entry) => rowFromTask(entry, at))
    const before = current.board.revision
    for (const row of rows) current.board.tasks.push(row)
    current.board.revision = before + 1
    locked.forget()
    locked.append({ at, op: 'update', revision: current.board.revision, rows, removed: [] })
    locked.adopt(current.board)
    locked.writeSnapshot(current.board)
    locked.writeExport(current.board)
    adopted = rows.map((row) => row.id)
    process.stdout.write(`write: adopted ${rows.length} row(s) at revision ${current.board.revision} (${adopted.join(', ')})\n`)
  })
  for (const message of warnings) process.stdout.write(`warn: ${message}\n`)
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write(`taskboard-adopt: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
