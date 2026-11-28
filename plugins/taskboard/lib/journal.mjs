/**
 * The LEGACY row journal (P1 residual risk 7): a hash-chained list of the writes to task rows.
 *
 * WHAT IT IS NOW. `.dsh/taskboard-journal.ndjson` holds one line per write that the board recorded
 * before verification moved into the change journal: `{ts, kind, id, payloadHash, prevHash, hash}`.
 * `payloadHash` is the sha256 of the ROW as the board stored it, and `hash` chains the previous
 * line. It is READ for rows the change journal (`taskboard.events.ndjson`, lib/store.mjs) never
 * wrote with its own check - a board written before this format - so those rows still close
 * normally and an edited row is still refused. It receives no new events: the change journal
 * carries each row's hash and the chain in the same record as the change (D-ONE, analysis
 * taskboard-write-integrity), and a second journal of new writes is exactly what fell out of step.
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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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

/**
 * Every readable event, in file order. A malformed COMPLETE line is kept as `{ broken: true }`;
 * bytes after the last newline are a torn write that was never acknowledged and are ignored.
 */
export function readJournal(cwd) {
  const path = journalPath(cwd)
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8')
  const events = []
  let start = 0
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', start)) {
    const line = text.slice(start, at)
    start = at + 1
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

/**
 * Verify the chain and one row's last event.
 *
 * A row with no event is LEGACY: the board was written by something that does not journal (an old
 * tool, a proof's fixture, or the change journal that now carries the check), and the close is not
 * this check's to refuse. Only a row this journal has seen must still match what it saw.
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
