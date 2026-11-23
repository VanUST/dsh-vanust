/**
 * The task journal (P1 residual risk 7): a hash-chained list of the writes to task rows.
 *
 * WHAT IT IS. `.dsh/taskboard-journal.ndjson` holds one line per write: `{ts, kind, id, payloadHash,
 * prevHash, hash}`. `payloadHash` is the sha256 of the ROW as the board stored it, and
 * `hash` chains the previous line, so removing, reordering or editing a line breaks the chain and a
 * hand edit of a JSON file no longer matches its last event.
 *
 * WHAT IT IS NOT. A signature. Anyone who can write both the case file and the journal can forge a
 * chain; the journal makes a LONE edit visible, which is the difference between "this file changed
 * and nobody recorded it" and "somebody with write access forged both". Do not describe it as
 * tamper-PROOF.
 *
 * LEGACY: a row with no event (a board written before the journal, or by another tool) reads as
 * legacy and closes normally, never as signed.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The journal lives beside the case files it describes. */
export const JOURNAL_FILE = join('.dsh', 'taskboard-journal.ndjson')

export function journalPath(cwd) {
  return join(cwd, JOURNAL_FILE)
}

/** sha256 of one row as the board stored it. */
function rowHash(row) {
  return createHash('sha256').update(JSON.stringify(row)).digest('hex')
}

/** One chained line: the previous hash is part of this hash, so order matters. */
function chainHash(event, prevHash) {
  return createHash('sha256').update([prevHash, event.kind, event.id, event.payloadHash, event.ts].join('|')).digest('hex')
}

/** Every readable event, in file order. A malformed line is kept as `{ broken: true }`. */
export function readJournal(cwd) {
  const path = journalPath(cwd)
  if (!existsSync(path)) return []
  const events = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed = JSON.parse(line)
      events.push(parsed !== null && typeof parsed === 'object' ? parsed : { broken: true })
    } catch {
      events.push({ broken: true })
    }
  }
  return events
}

/** Append one event for a row that was just written. Returns the event, or null. */
export function appendRowEvent(cwd, kind, row) {
  if (row === null || typeof row !== 'object' || typeof row.id !== 'string') return null
  const previous = readJournal(cwd).filter((event) => event.broken !== true)
  const prevHash = previous.length === 0 ? 'genesis' : String(previous[previous.length - 1].hash ?? 'genesis')
  const event = { ts: new Date().toISOString(), kind, id: row.id, payloadHash: rowHash(row), prevHash }
  event.hash = chainHash(event, prevHash)
  try {
    mkdirSync(dirname(journalPath(cwd)), { recursive: true })
    appendFileSync(journalPath(cwd), JSON.stringify(event) + '\n', 'utf8')
  } catch {
    return null
  }
  return event
}

/**
 * Verify the chain and one row's last event.
 *
 * A row with no event is LEGACY: the board was written by something that does not journal (an old
 * tool, a proof's fixture), and the close is not this check's to refuse. Only a row the journal has
 * seen must still match what the journal saw.
 *
 * @returns `{ status: 'legacy' | 'ok' | 'mismatch' | 'broken', detail? }`
 */
export function checkRow(cwd, row) {
  if (row === null || typeof row !== 'object' || typeof row.id !== 'string') return { status: 'legacy' }
  const events = readJournal(cwd)
  if (events.length === 0) return { status: 'legacy' }
  let prevHash = 'genesis'
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event.broken === true || event.prevHash !== prevHash || event.hash !== chainHash(event, prevHash)) {
      return { status: 'broken', detail: `journal line ${index + 1} does not chain (${event.id ?? 'unknown'})` }
    }
    prevHash = event.hash
  }
  const own = events.filter((event) => event.id === row.id)
  if (own.length === 0) return { status: 'legacy' }
  const last = own[own.length - 1]
  return rowHash(row) === last.payloadHash
    ? { status: 'ok' }
    : { status: 'mismatch', detail: `task ${row.id} changed after its last journal event (${last.kind} at ${last.ts}) and no write recorded the change` }
}
