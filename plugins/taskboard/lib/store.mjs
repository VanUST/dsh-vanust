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
 * VERIFICATION IS PART OF THE WRITE. Every event carries `check: {prev, hash, rows}`: `rows` maps
 * each row the event wrote to the sha256 of that row, `hash` covers the event's own content, and
 * `prev` chains it to the previous event. An edited row, an edited record and a record removed
 * inside the chain are visible, and the row change and its verification data are ONE record, so
 * there is no second journal to fall out of step. The legacy `.dsh/taskboard-journal.ndjson` is
 * still READ for rows written before this format; it receives no new events (lib/journal.mjs).
 *
 * RECOVERY. A snapshot that does not parse, or a journal that lost its genesis, is named in the
 * log and the board is rebuilt from the journal. With no journal at all the export is read as
 * before: an old workspace keeps working and no migration happens on the read path. The first
 * event of a fresh board is a genesis, so that one journal alone rebuilds it. A torn last line
 * (no newline) was never acknowledged: it is dropped before the next append, never applied, and
 * never mistaken for a damaged record. A COMPLETE line that does not parse is a damaged record:
 * the board stops before it, and the close refuses instead of silently dropping it.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, truncateSync, writeFileSync } from 'node:fs'
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

/** sha256 of one row exactly as the event stored it. */
const rowHash = (row) => createHash('sha256').update(JSON.stringify(row)).digest('hex')

/**
 * sha256 of one event's content plus the previous record's hash. The values are joined explicitly
 * (not the serialized object), so the hash does not depend on property order in the line.
 */
const recordHash = (prev, event) => createHash('sha256').update([
  prev,
  String(event.at ?? ''),
  String(event.op ?? ''),
  String(event.revision ?? ''),
  JSON.stringify(Array.isArray(event.rows) ? event.rows : []),
  JSON.stringify(Array.isArray(event.removed) ? event.removed : []),
  JSON.stringify(Array.isArray(event.agents) ? event.agents : null),
  JSON.stringify(Array.isArray(event.order) ? event.order : null),
].join('|')).digest('hex')

/** The verification record an event carries: its rows' hashes, its own hash, and its link back. */
const checkOf = (event, prev) => {
  const rows = {}
  for (const row of Array.isArray(event.rows) ? event.rows : []) {
    if (row !== null && typeof row === 'object' && typeof row.id === 'string') rows[row.id] = rowHash(row)
  }
  const hash = recordHash(prev, event)
  return { prev, hash, rows }
}

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

/**
 * Read the events file from a byte offset.
 *
 * A line that ends with a newline was a COMPLETE record; when it does not parse it is `damaged`
 * and the read stops before it, so the close can refuse instead of dropping it. Bytes after the
 * last whole line without a newline are a torn write that was never acknowledged: `torn` is their
 * size, they are not applied, and the next append drops them.
 */
function readTail(path, from, until = null) {
  if (!existsSync(path)) return { events: [], offset: from, torn: 0, damaged: null }
  const fileSize = statSync(path).size
  const size = until === null ? fileSize : Math.min(fileSize, until)
  if (size <= from) return { events: [], offset: from, torn: 0, damaged: null }
  // Read only the tail, not the whole journal: a 13 MB journal with a 20 KB tail must cost the
  // tail, or every operation pays the file (measured: 19 ms against 1 ms on a 12.9 MB board).
  const buffer = Buffer.alloc(size - from)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buffer, 0, buffer.length, from)
  } finally {
    closeSync(fd)
  }
  const text = buffer.toString('utf8')
  const events = []
  let consumed = 0
  let lineStart = 0
  let damaged = null
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', lineStart)) {
    const line = text.slice(lineStart, at)
    const end = at + 1
    if (line.trim() === '') {
      consumed = end
      lineStart = end
      continue
    }
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      damaged = {
        line: events.length + 1,
        offset: from + Buffer.byteLength(text.slice(0, lineStart), 'utf8'),
      }
      break
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      damaged = {
        line: events.length + 1,
        offset: from + Buffer.byteLength(text.slice(0, lineStart), 'utf8'),
      }
      break
    }
    events.push(parsed)
    consumed = end
    lineStart = end
  }
  const offset = from + Buffer.byteLength(text.slice(0, consumed), 'utf8')
  return { events, offset, torn: damaged === null ? Math.max(0, size - offset) : 0, damaged }
}

/**
 * Verify the journal the snapshot COVERS: parse every record up to the snapshot offset and run the
 * chain. A snapshot is the writer's own cache, not a signature; a record damaged or edited inside
 * the covered prefix must be visible on a cold load, or a lone hand edit would be hidden by the
 * very file that is supposed to summarise it (observed: the close accepted a covered record whose
 * hash no longer matched).
 */
function readCovered(path, end) {
  const tail = readTail(path, 0, end)
  if (tail.damaged !== null) return { events: tail.events, damaged: tail.damaged, torn: 0 }
  if (tail.offset < end) return { events: tail.events, damaged: null, torn: end - tail.offset }
  return { events: tail.events, damaged: null, torn: 0 }
}

/**
 * Drop a torn, never-acknowledged tail: if the file does not end with a newline, cut it back to
 * the byte after the last newline. Nothing that ends a line is touched.
 */
function repairTornTail(path) {
  if (!existsSync(path)) return false
  const size = statSync(path).size
  if (size === 0) return false
  const chunk = Math.min(size, 64 * 1024)
  const head = Buffer.alloc(chunk)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, head, 0, chunk, size - chunk)
  } finally {
    closeSync(fd)
  }
  if (head[head.length - 1] === 0x0a) return false
  let keep
  const cut = head.lastIndexOf(0x0a)
  if (cut !== -1) {
    keep = size - chunk + cut + 1
  } else if (chunk === size) {
    keep = 0
  } else {
    const all = readFileSync(path)
    keep = all.lastIndexOf(0x0a) + 1
  }
  truncateSync(path, keep)
  return true
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
  /** Hash of the last verified record the load or append left; 'genesis' for the first one. */
  let tip = null
  /** id -> {hash, kind, ts}: the last verified row write, for the close's check. */
  let confirmed = new Map()
  /** `{line, offset}` when a complete journal record is damaged; null otherwise. */
  let damage = null
  /** Whether the last load consumed the journal to its end from a known offset. */
  let cursorKnown = false
  /** id -> the record that wrote it WITHOUT verification data after the chain started. */
  let unverified = new Map()
  /** Whether any verified record has been folded since the load started. */
  let verifiedSeen = false

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

  /** A row's verification entry, tolerant of the bare hash the first format stored. */
  const checkEntry = (value) => (value !== null && typeof value === 'object' && typeof value.hash === 'string'
    ? { hash: value.hash, kind: String(value.kind ?? ''), ts: String(value.ts ?? '') }
    : { hash: String(value ?? ''), kind: '', ts: '' })

  const readSnapshot = () => {
    const parsed = JSON.parse(readFileSync(where.snapshot, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || parsed.version !== SNAPSHOT_VERSION || parsed.board === undefined) {
      throw new Error('snapshot version ' + JSON.stringify(parsed?.version) + ' is not ' + SNAPSHOT_VERSION)
    }
    const raw = parsed.check !== null && parsed.check !== undefined && typeof parsed.check === 'object' ? parsed.check : null
    const rows = {}
    if (raw !== null && raw.rows !== null && typeof raw.rows === 'object' && !Array.isArray(raw.rows)) {
      for (const [id, value] of Object.entries(raw.rows)) rows[id] = checkEntry(value)
    }
    return {
      board: boardOf(parsed.board),
      offset: Number.isSafeInteger(parsed.offset) ? parsed.offset : 0,
      check: raw !== null && typeof raw.hash === 'string' ? { hash: raw.hash, rows } : null,
    }
  }

  /** Fold the whole journal from its first byte. Only the recovery path pays for this. */
  const replayAll = () => {
    const tail = readTail(where.events, 0)
    if (tail.events.length === 0 || tail.events[0].op !== 'genesis') {
      return { ok: false, reason: tail.events.length === 0 ? 'the journal has no events' : 'the journal has no genesis event', tail }
    }
    const board = { version: tail.events[0].version ?? 1, revision: 0, tasks: [], agents: [] }
    return { ok: true, board, tail }
  }

  /**
   * Verify each checked event and carry the chain tip and the last confirmed write per row.
   * A record that does not match its own hash, or does not chain, is a break: the state is still
   * folded (a read does not fail), but the close refuses it.
   */
  const applyChecks = (events) => {
    let chainBreak = null
    for (const event of events) {
      const check = event !== null && typeof event === 'object' && event.check !== null && typeof event.check === 'object' ? event.check : null
      const verified = check !== null && typeof check.hash === 'string'
      if (verified) {
        const prev = typeof check.prev === 'string' ? check.prev : 'genesis'
        if (check.hash !== recordHash(prev, event)) {
          if (chainBreak === null) chainBreak = 'journal record (revision ' + String(event.revision ?? '?') + ', op ' + String(event.op ?? '?') + ') does not match its own hash'
        } else if (tip !== null && prev !== tip) {
          if (chainBreak === null) chainBreak = 'journal record (revision ' + String(event.revision ?? '?') + ') does not chain to the previous record'
        }
        tip = check.hash
        if (check.rows !== null && typeof check.rows === 'object' && !Array.isArray(check.rows)) {
          for (const [id, hash] of Object.entries(check.rows)) {
            confirmed.set(id, { hash: String(hash), kind: String(event.op ?? ''), ts: String(event.at ?? '') })
          }
        }
      }
      const checked = verified && check.rows !== null && typeof check.rows === 'object' ? check.rows : null
      for (const row of Array.isArray(event.rows) ? event.rows : []) {
        if (row === null || typeof row !== 'object' || typeof row.id !== 'string') continue
        if (checked !== null && Object.hasOwn(checked, row.id)) {
          confirmed.set(row.id, { hash: checked[row.id], kind: String(event.op ?? ''), ts: String(event.at ?? '') })
          unverified.delete(row.id)
          continue
        }
        confirmed.delete(row.id)
        // A record WITHOUT verification data is legitimate only before the chain starts (a board
        // written by the old format). After it, such a record is a hand edit that must not
        // confirm the row it wrote (observed: an unchecked record carried a hand-edited row and
        // the close accepted it).
        if (verifiedSeen) unverified.set(row.id, { kind: String(event.op ?? ''), ts: String(event.at ?? '') })
      }
      for (const id of Array.isArray(event.removed) ? event.removed : []) { confirmed.delete(id); unverified.delete(id) }
      if (verified) verifiedSeen = true
    }
    return chainBreak
  }

  Object.assign(store, {
    paths: where,

    /**
     * The board: snapshot plus tail. Returns `{board, source, replayed, cacheHit, damaged, torn,
     * chainOk}` where source is 'snapshot+tail', 'recovered' (the snapshot failed and the journal
     * rebuilt it), 'export' (no journal yet) or 'empty'.
     */
    load() {
      const key = statKey()
      if (cached !== null && cached.key === key) return { ...cached.result, cacheHit: true }
      cursor = { offset: 0, events: 0 }
      tip = null
      confirmed = new Map()
      unverified = new Map()
      verifiedSeen = false
      damage = null
      cursorKnown = false
      let chainBreak = null
      let torn = 0
      let board = null
      let source = 'export'
      let offset = 0
      let tail = { events: [], offset: 0, torn: 0, damaged: null }
      const hasSnapshot = existsSync(where.snapshot)
      const hasEvents = existsSync(where.events)

      if (hasSnapshot) {
        try {
          const snap = readSnapshot()
          board = snap.board
          offset = snap.offset
          source = 'snapshot+tail'
          if (snap.check !== null) {
            tip = snap.check.hash
            for (const [id, entry] of Object.entries(snap.check.rows)) confirmed.set(id, entry)
          }
          // THE SNAPSHOT DOES NOT CONFIRM ITSELF. The records it covers are read and chained on a
          // cold load: a damaged or hand-edited record inside the prefix is a refusal, not a cache
          // hit. A warm load (same sizes, same mtimes) already returned above and pays nothing.
          // A JOURNAL MISSING OR SHORTER THAN THE SNAPSHOT'S OFFSET IS A LOST JOURNAL: the snapshot
          // claims records the journal does not have, so the state cannot be confirmed. The export
          // stays readable (the torn branch below uses it); the close refuses. It is NOT the
          // legacy no-journal shape: that shape has no snapshot claiming the lost records.
          if (source === 'snapshot+tail') {
            const covered = readCovered(where.events, snap.offset)
            if (covered.damaged !== null) {
              damage = covered.damaged
            } else if (covered.torn > 0) {
              damage = { line: covered.events.length + 1, offset: snap.offset, reason: 'the snapshot covers a journal that ends before its offset; the board cannot be confirmed' }
              // The journal is lost: the snapshot cannot be confirmed, and the export is the newest
              // readable projection of the confirmed state. A READ may show it; the close refuses.
              if (existsSync(where.board)) {
                try {
                  board = readExport().board
                } catch {
                  // keep the snapshot's board
                }
              }
              tip = null
              confirmed = new Map()
              unverified = new Map()
              verifiedSeen = false
              source = 'snapshot+export'
            } else {
              const claimed = snap.check === null ? null : snap.check.hash
              tip = null
              confirmed = new Map()
              chainBreak = applyChecks(covered.events)
              if (chainBreak === null && claimed !== null && claimed !== 'genesis' && tip !== claimed) {
                chainBreak = 'the snapshot does not match the journal it covers (the covered records end at ' + String(tip ?? 'no checked record') + ')'
              }
              if (chainBreak === null && claimed === 'genesis' && tip !== null) {
                chainBreak = 'the journal has checked records the snapshot does not cover'
              }
            }
          }
        } catch (error) {
          warn('taskboard: snapshot ' + where.snapshot + ' is unreadable (' + error.message + '); rebuilding the board from the journal')
        }
      }

      if (board === null) {
        const full = replayAll()
        tail = full.tail
        if (full.ok) {
          board = full.board
          source = hasSnapshot ? 'recovered' : 'journal'
        } else {
          if (hasSnapshot || hasEvents) {
            warn('taskboard: cannot rebuild the board from ' + where.events + ' (' + full.reason + '); reading the export as before')
          }
          const read = readExport()
          board = read.board
          source = read.source
          tail = { events: [], offset: 0, torn: 0, damaged: null }
        }
      } else if (source === 'snapshot+tail') {
        tail = readTail(where.events, offset)
      }

      if (source === 'snapshot+tail' || source === 'journal' || source === 'recovered') {
        for (const event of tail.events) applyEvent(board, event)
        // The covered prefix may already have found a break or a damaged record; the tail adds to
        // that state, it does not replace it.
        const tailBreak = applyChecks(tail.events)
        if (chainBreak === null && tailBreak !== null) chainBreak = tailBreak
        torn = tail.torn
        if (tail.damaged !== null) damage = tail.damaged
        cursor = { offset: tail.offset, events: tail.events.length }
        cursorKnown = true
      }

      const result = {
        board,
        source,
        replayed: tail.events.length,
        cacheHit: false,
        damaged: damage !== null,
        torn,
        chainOk: chainBreak === null,
        damageDetail: damage === null ? null : (typeof damage.reason === 'string' ? damage.reason : 'journal tail record ' + damage.line + ' is damaged; the board is read only up to the record before it'),
        chainDetail: chainBreak,
      }
      cached = { key: statKey(), result }
      if (damage !== null) warn('taskboard: ' + where.events + ' has a damaged record at line ' + damage.line + '; the close will refuse until it is repaired')
      return result
    },

    /**
     * Append one event, with its verification record in the same line. Returns the bytes written.
     * A torn last line is dropped first (it was never acknowledged); a damaged complete record
     * stops the write instead of appending behind it.
     */
    append(event) {
      mkdirSync(where.dir, { recursive: true })
      repairTornTail(where.events)
      const state = this.load()
      if (state.damaged) throw new Error('taskboard: ' + where.events + ' has a damaged record (' + state.damageDetail + '); refusing to append after it')
      if (state.chainOk === false) throw new Error('taskboard: ' + where.events + ' does not chain (' + state.chainDetail + '); refusing to append')
      const check = checkOf(event, tip ?? 'genesis')
      const line = JSON.stringify({ ...event, check }) + '\n'
      appendFileSync(where.events, line, 'utf8')
      tip = check.hash
      for (const [id, hash] of Object.entries(check.rows)) {
        confirmed.set(id, { hash, kind: String(event.op ?? ''), ts: String(event.at ?? '') })
      }
      for (const id of Array.isArray(event.removed) ? event.removed : []) confirmed.delete(id)
      cursor = { offset: cursor.offset + Buffer.byteLength(line, 'utf8'), events: cursor.events + 1 }
      cached = null
      return Buffer.byteLength(line, 'utf8')
    },

    /**
     * Check one row the close is about to accept against the last record that wrote it.
     * Returns `{status: 'ok' | 'mismatch' | 'broken' | 'none'}`; 'none' means no record in this
     * journal wrote the row, so the caller falls back to the legacy row journal.
     */
    verify(row) {
      const state = this.load()
      if (state.damaged) return { status: 'broken', detail: state.damageDetail }
      if (state.chainOk === false) return { status: 'broken', detail: state.chainDetail }
      if (row === null || typeof row !== 'object' || typeof row.id !== 'string') return { status: 'none' }
      const suspect = unverified.get(row.id)
      if (suspect !== undefined) {
        return {
          status: 'broken',
          detail: 'task ' + row.id + ' was written by a journal record without verification data (' + (suspect.kind === '' ? 'write' : suspect.kind) + ' at ' + suspect.ts + ') after the chain started; the row cannot be confirmed',
        }
      }
      const last = confirmed.get(row.id)
      if (last === undefined) return { status: 'none' }
      if (rowHash(row) === last.hash) return { status: 'ok' }
      return {
        status: 'mismatch',
        detail: 'task ' + row.id + ' changed after its last recorded write (' + (last.kind === '' ? 'write' : last.kind) + ' at ' + last.ts + ') and no write recorded the change',
      }
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

    /**
     * Drop the in-memory board before the caller changes the board it loaded. A write that throws
     * after the change must not leave the changed board cached for the next operation (observed: a
     * close that threw mid-write reappeared in the next record as `done`). Success re-caches
     * through adopt().
     */
    forget() {
      cached = null
    },

    /** Take this board as the current in-memory state: the caller mutated the board it loaded. */
    adopt(board) {
      cached = { key: statKey(), result: { board, source: 'snapshot+tail', replayed: 0, cacheHit: false, damaged: false, torn: 0, chainOk: true, damageDetail: null, chainDetail: null } }
      return board
    },

    /** Write the snapshot covering the whole journal, atomically. Returns its bytes and offset. */
    writeSnapshot(board) {
      mkdirSync(where.dir, { recursive: true })
      const offset = existsSync(where.events) ? statSync(where.events).size : 0
      const rows = {}
      for (const [id, entry] of confirmed) rows[id] = entry
      const text = JSON.stringify({
        version: SNAPSHOT_VERSION,
        at: new Date().toISOString(),
        offset,
        check: { hash: tip ?? 'genesis', rows },
        board: boardOf(board),
      }, null, 2) + '\n'
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
     * be rebuilt. The export itself is never rewritten by the migration. The genesis carries no
     * row hashes: the export does not confirm itself, so those rows stay legacy until a write.
     */
    migrate() {
      // A SNAPSHOT THAT COVERS A MISSING OR EMPTY JOURNAL IS A LOST JOURNAL, NOT AN OLD BOARD.
      // Rebuilding a genesis from the export would re-confirm rows the snapshot already claimed
      // and turn an unconfirmable state into a silent success (observed: closeMany rewrote the
      // absent journal and returned done while the single close refused).
      if (existsSync(where.snapshot) && (!existsSync(where.events) || statSync(where.events).size === 0)) {
        return { migrated: false, reason: 'the snapshot covers a journal that is missing or empty' }
      }
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
        // A new journal starts a new chain: an in-memory tip from a journal that is no longer on
        // disk must not anchor the first record written after this genesis.
        tip = null
        confirmed = new Map()
        unverified = new Map()
        verifiedSeen = false
        damage = null
        cursor = { offset: statSync(where.events).size, events: 1 }
      }
      store.writeSnapshot(board)
      cached = null
      const after = readFileSync(where.board)
      return { migrated: true, genesis: wroteGenesis, exportUnchanged: before.equals(after), rows: boardOf(board).tasks.length }
    },
  })

  return store
}
