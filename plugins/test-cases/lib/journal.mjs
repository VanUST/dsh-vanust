/**
 * The case journal (P1 residual risk 7): a hash-chained list of the writes to a case library.
 *
 * WHAT IT IS. `docs/cases/journal.ndjson` holds one line per write: `{ts, kind, id, payloadHash,
 * prevHash, hash}`. `payloadHash` is the sha256 of the case FILE at the moment of the write, and
 * `hash` chains the previous line, so removing, reordering or editing a line breaks the chain and a
 * hand edit of a JSON file no longer matches its last event.
 *
 * WHAT IT IS NOT. A signature. Anyone who can write both the case file and the journal can forge a
 * chain; the journal makes a LONE edit visible, which is the difference between "this file changed
 * and nobody recorded it" and "somebody with write access forged both". Do not describe it as
 * tamper-PROOF.
 *
 * LEGACY: a case with no event is readable and is reported as unsigned (`legacy: true`), never as
 * verified by the journal.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The journal lives beside the case files it describes. */
export const JOURNAL_FILE = 'journal.ndjson'

export function journalPath(dir) {
  return join(dir, JOURNAL_FILE)
}

/** sha256 of a file's bytes, or null when it cannot be read. */
function fileHash(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return null
  }
}

/** One chained line: the previous hash is part of this hash, so order matters. */
function chainHash(event, prevHash) {
  return createHash('sha256').update([prevHash, event.kind, event.id, event.payloadHash, event.ts].join('|')).digest('hex')
}

/** Every readable event, in file order. A malformed line is kept as `{ broken: true }`. */
export function readJournal(dir) {
  const path = journalPath(dir)
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

/** Append one event for a case file that was just written. Returns the event, or null. */
export function appendCaseEvent(dir, kind, id, path) {
  const payloadHash = fileHash(path)
  if (payloadHash === null) return null
  const previous = readJournal(dir).filter((event) => event.broken !== true)
  const prevHash = previous.length === 0 ? 'genesis' : String(previous[previous.length - 1].hash ?? 'genesis')
  const event = { ts: new Date().toISOString(), kind, id, payloadHash, prevHash }
  event.hash = chainHash(event, prevHash)
  try {
    appendFileSync(journalPath(dir), JSON.stringify(event) + '\n', 'utf8')
  } catch {
    return null
  }
  return event
}

/**
 * Verify the chain and one case's last event.
 *
 * @returns `{ status: 'legacy' | 'ok' | 'mismatch' | 'broken', detail? }`
 */
export function checkCase(dir, id, path) {
  const events = readJournal(dir)
  if (events.length === 0) return { status: 'legacy' }
  // The chain first: a broken link means somebody rewrote history, whatever this case says.
  let prevHash = 'genesis'
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event.broken === true || event.prevHash !== prevHash || event.hash !== chainHash(event, prevHash)) {
      return { status: 'broken', detail: `journal line ${index + 1} does not chain (${event.id ?? 'unknown'})` }
    }
    prevHash = event.hash
  }
  const own = events.filter((event) => event.id === id)
  if (own.length === 0) return { status: 'legacy' }
  const last = own[own.length - 1]
  const current = fileHash(path)
  if (current === null) return { status: 'mismatch', detail: `the case file of "${id}" is gone but the journal records a write` }
  if (current !== last.payloadHash) {
    return { status: 'mismatch', detail: `the case file of "${id}" changed after its last journal event (${last.kind} at ${last.ts}) and no write recorded the change` }
  }
  return { status: 'ok' }
}
