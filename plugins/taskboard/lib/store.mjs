/**
 * The board as a journal plus a snapshot: the read and write path a long-lived workspace needs.
 *
 * WHY. A board of 1 553 tasks is a 13 MB JSON document, and every write rewrote all of it
 * (measured on a copy: 295 ms per write, 116 ms per read). The journal is the source of truth;
 * the export stays as the file the panel and outside tools already read.
 *
 * READ. `taskboard.snapshot.json` (a board plus the journal offset it covers) plus the tail of
 * `taskboard.events.ndjson` from that offset. A warm read is two stats: same sizes, same board.
 *
 * WRITE. One line per operation: the rows it touched, the ids it removed, the agents list when it
 * changed, the revision it reached. The snapshot is rewritten only past SNAPSHOT_EVERY events, or
 * when the export is written.
 *
 * RECOVERY. A snapshot that does not parse, or a journal that lost its genesis, is named in the
 * log and the board is rebuilt from the journal. With no journal at all the export is read as
 * before: an old workspace keeps working and no migration happens on the read path.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The snapshot beside the board it covers, and the journal it reads its tail from. */
export const SNAPSHOT_FILE = 'taskboard.snapshot.json'
export const EVENTS_FILE = 'taskboard.events.ndjson'
/** Past this many events since the snapshot, the snapshot is rewritten. */
export const SNAPSHOT_EVERY = 400
/** The snapshot document version; a different one is rebuilt from the journal, never guessed at. */
export const SNAPSHOT_VERSION = 1

const pathsFor = (boardPath) => ({
  board: boardPath,
  dir: dirname(boardPath),
  snapshot: join(dirname(boardPath), SNAPSHOT_FILE),
  events: join(dirname(boardPath), EVENTS_FILE),
})

/** A board document in the shape the export uses, so JSON.stringify of both is the same bytes. */
const boardOf = (value) => ({
  version: value.version,
  revision: Number.isSafeInteger(value.revision) ? value.revision : 0,
  tasks: Array.isArray(value.tasks) ? value.tasks : [],
  agents: Array.isArray(value.agents) ? value.agents : [],
})

/** The export text: the one place that decides the derived file's bytes. */
export const exportText = (board) => JSON.stringify(boardOf(board), null, 2) + '\n'

/**
 * Apply one event to a board in place. Last write wins per id; a new id is appended, so the task
 * order the export had is kept; `removed` deletes; `order` (only an operation that reorders the
 * board sends it) reorders; `agents` replaces the list whole.
 */
function applyEvent(board, event) {
  if (Array.isArray(event.rows)) {
    const index = new Map(board.tasks.map((task, at) => [task?.id, at]))
    for (const row of event.rows) {
      if (row === null || typeof row !== 'object' || typeof row.id !== 'string') continue
      const at = index.get(row.id)
      if (at === undefined) {
        index.set(row.id, board.tasks.length)
        board.tasks.push(row)
      } else {
        board.tasks[at] = row
      }
    }
  }
  if (Array.isArray(event.removed) && event.removed.length > 0) {
    const gone = new Set(event.removed)
    board.tasks = board.tasks.filter((task) => !gone.has(task?.id))
  }
  if (Array.isArray(event.order)) {
    const byId = new Map(board.tasks.map((task) => [task.id, task]))
    const ordered = event.order.map((id) => byId.get(id)).filter((task) => task !== undefined)
    for (const task of board.tasks) if (!event.order.includes(task.id)) ordered.push(task)
    board.tasks = ordered
  }
  if (Array.isArray(event.agents)) board.agents = event.agents
  if (Number.isSafeInteger(event.revision)) board.revision = event.revision
}

/** Read the events file from a byte offset, ignoring a half-written last line. */
function readTail(path, from) {
  if (!existsSync(path)) return { events: [], offset: from }
  const size = statSync(path).size
  if (size <= from) return { events: [], offset: from }
  const text = readFileSync(path).subarray(from).toString('utf8')
  const events = []
  let consumed = 0
  let lineStart = 0
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', lineStart)) {
    const line = text.slice(lineStart, at)
    lineStart = at + 1
    if (line.trim() === '') {
      consumed = lineStart
      continue
    }
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      // A torn tail line is not a lost operation: it was never acknowledged. Stop before it, so
      // the next append lands after the last whole event.
      break
    }
    if (parsed === null || typeof parsed !== 'object') break
    events.push(parsed)
    consumed = lineStart
  }
  return { events, offset: from + Buffer.byteLength(text.slice(0, consumed), 'utf8') }
}

/**
 * @param boardPath - Absolute path of the derived export (`.dsh/taskboard.json`).
 * @param logger - Anything with `warn`, for the recovery and degradation messages.
 */
export function createStore({ boardPath, logger }) {
  const where = pathsFor(boardPath)
  const warn = (message) => logger?.warn?.(message)
  const store = {}
  let cached = null
  /** Where the loaded board stops in the journal: a count, so a write never parses the snapshot. */
  let cursor = { offset: 0, events: 0 }

  const statKey = () => {
    const snap = existsSync(where.snapshot) ? statSync(where.snapshot) : null
    const events = existsSync(where.events) ? statSync(where.events) : null
    return [snap === null ? '-' : snap.size + ':' + snap.mtimeMs, events === null ? '-' : events.size + ':' + events.mtimeMs].join('|')
  }

  /** The export read as today, for a workspace that has neither snapshot nor journal. */
  const readExport = () => {
    if (!existsSync(where.board)) return { board: { version: 1, revision: 0, tasks: [], agents: [] }, source: 'empty' }
    const parsed = JSON.parse(readFileSync(where.board, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.tasks)) {
      throw new Error('taskboard: ' + where.board + ' has no tasks array')
    }
    return { board: boardOf(parsed), source: 'export' }
  }

  const readSnapshot = () => {
    const parsed = JSON.parse(readFileSync(where.snapshot, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || parsed.version !== SNAPSHOT_VERSION || parsed.board === undefined) {
      throw new Error('snapshot version ' + JSON.stringify(parsed?.version) + ' is not ' + SNAPSHOT_VERSION)
    }
    return { board: boardOf(parsed.board), offset: Number.isSafeInteger(parsed.offset) ? parsed.offset : 0 }
  }

  /** Fold the whole journal from its first byte. Only the recovery path pays for this. */
  const replayAll = () => {
    const { events } = readTail(where.events, 0)
    if (events.length === 0 || events[0].op !== 'genesis') {
      return { ok: false, reason: events.length === 0 ? 'the journal has no events' : 'the journal has no genesis event' }
    }
    const board = { version: events[0].version ?? 1, revision: 0, tasks: [], agents: [] }
    for (const event of events) applyEvent(board, event)
    return { ok: true, board, events }
  }

  Object.assign(store, {
    paths: where,

    /**
     * The board: snapshot plus tail. Returns `{ board, source, replayed, cacheHit }` where source
     * is 'snapshot+tail', 'recovered' (the snapshot failed and the journal rebuilt it), 'export'
     * (no journal yet) or 'empty'.
     */
    load() {
      const key = statKey()
      if (cached !== null && cached.key === key) {
        return { board: cached.board, source: cached.source, replayed: cached.replayed, cacheHit: true }
      }
      cursor = { offset: 0, events: 0 }

      let board = null
      let source = 'export'
      let offset = 0
      let replayed = 0
      const hasSnapshot = existsSync(where.snapshot)
      const hasEvents = existsSync(where.events)

      if (hasSnapshot) {
        try {
          const snap = readSnapshot()
          board = snap.board
          offset = snap.offset
          source = 'snapshot+tail'
        } catch (error) {
          warn('taskboard: snapshot ' + where.snapshot + ' is unreadable (' + error.message + '); rebuilding the board from the journal')
        }
      }

      if (board === null) {
        const full = replayAll()
        if (full.ok) {
          board = full.board
          offset = 0
          source = hasSnapshot ? 'recovered' : 'journal'
          replayed = full.events.length
        } else {
          if (hasSnapshot || hasEvents) {
            warn('taskboard: cannot rebuild the board from ' + where.events + ' (' + full.reason + '); reading the export as before')
          }
          const read = readExport()
          board = read.board
          source = read.source
        }
      }

      if (source === 'snapshot+tail' || source === 'journal') {
        const tail = readTail(where.events, offset)
        for (const event of tail.events) applyEvent(board, event)
        replayed = tail.events.length
        cursor = { offset, events: tail.events.length }
      }

      cached = { key: statKey(), board, source, replayed }
      return { board, source, replayed, cacheHit: false }
    },

    /** Append one event. Returns the bytes written (one JSON line). */
    append(event) {
      mkdirSync(where.dir, { recursive: true })
      const line = JSON.stringify(event) + '\n'
      appendFileSync(where.events, line, 'utf8')
      cursor = { offset: cursor.offset, events: cursor.events + 1 }
      cached = null
      return Buffer.byteLength(line, 'utf8')
    },

    /** How many events the current snapshot does not cover, as of the last load or append. */
    tailLength() {
      return cursor.events
    },

    /** Whether a snapshot exists: the first write of a workspace has to make one. */
    hasSnapshot() {
      return existsSync(where.snapshot)
    },

    /** Bytes of the derived export on disk, so a caller can tell a small board from a large one. */
    exportSize() {
      return existsSync(where.board) ? statSync(where.board).size : 0
    },

    /** Take this board as the current in-memory state: the caller mutated the board it loaded. */
    adopt(board) {
      cached = { key: statKey(), board, source: 'snapshot+tail', replayed: 0 }
      return board
    },

    /** Write the snapshot covering the whole journal, atomically. Returns its bytes and offset. */
    writeSnapshot(board) {
      mkdirSync(where.dir, { recursive: true })
      const offset = existsSync(where.events) ? statSync(where.events).size : 0
      const text = JSON.stringify({ version: SNAPSHOT_VERSION, at: new Date().toISOString(), offset, board: boardOf(board) }, null, 2) + '\n'
      const temp = where.snapshot + '.' + process.pid + '.tmp'
      writeFileSync(temp, text, 'utf8')
      renameSync(temp, where.snapshot)
      cached = null
      cursor = { offset, events: 0 }
      return { bytes: Buffer.byteLength(text, 'utf8'), offset }
    },

    /** Write the derived export the panel reads, atomically. */
    writeExport(board) {
      mkdirSync(where.dir, { recursive: true })
      const text = exportText(board)
      const temp = where.board + '.' + process.pid + '.tmp'
      writeFileSync(temp, text, 'utf8')
      renameSync(temp, where.board)
      return Buffer.byteLength(text, 'utf8')
    },

    /**
     * The first run on a workspace that has only the old export: the export becomes the snapshot
     * (offset 0) and the whole board becomes the genesis event, so a damaged snapshot can always
     * be rebuilt. The export itself is never rewritten by the migration.
     */
    migrate() {
      if (existsSync(where.snapshot) && existsSync(where.events) && statSync(where.events).size > 0) return { migrated: false }
      if (!existsSync(where.board)) return { migrated: false, reason: 'no board' }
      const before = readFileSync(where.board)
      const board = JSON.parse(before.toString('utf8'))
      mkdirSync(where.dir, { recursive: true })
      let wroteGenesis = false
      if (!existsSync(where.events) || statSync(where.events).size === 0) {
        const base = boardOf(board)
        const genesis = { at: new Date().toISOString(), op: 'genesis', revision: base.revision, version: base.version, rows: base.tasks, removed: [], agents: base.agents }
        appendFileSync(where.events, JSON.stringify(genesis) + '\n', 'utf8')
        wroteGenesis = true
      }
      store.writeSnapshot(board)
      cached = null
      const after = readFileSync(where.board)
      return { migrated: true, genesis: wroteGenesis, exportUnchanged: before.equals(after), rows: boardOf(board).tasks.length }
    },
  })

  return store
}
