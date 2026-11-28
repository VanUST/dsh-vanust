/**
 * PURPOSE
 *   Compose the two model-visible state messages: L1 (the cold-start block a root session gets
 *   once) and L2 (the small delta for a turn boundary whose state hash changed).
 *
 * WHAT IS READ
 *   Only the projections the project-state core generated: `state/views/digest.md`,
 *   `state/views/board.md`, `state/views/snapshot.md`, plus `state/plan.yaml` when it exists.
 *   Nothing here writes state, and nothing parses the projections back into an entity model.
 *
 * DETERMINISM
 *   The text is a pure function of those files (no clock), so the content hash is a stable
 *   "did the state change" signal: the same state always produces the same hash.
 */

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const L1_HEADER = 'STATE (L1, generated — do not edit the projections): the project state of this workspace.'
export const L2_HEADER = 'STATE (L2, delta): the project state changed since the last turn.'
export const L2_LIMIT_BYTES = 1200

const utf8 = (text) => Buffer.byteLength(text ?? '', 'utf8')

const readIf = (path) => {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

/** Read the projection set; `ok: false` means there is no state to deliver. */
export function readState(cwd) {
  if (typeof cwd !== 'string' || cwd === '') return { ok: false, reason: 'no-cwd' }
  const views = join(cwd, 'state', 'views')
  const digest = readIf(join(views, 'digest.md'))
  if (digest === null) return { ok: false, reason: 'no-state' }
  const board = readIf(join(views, 'board.md')) ?? ''
  const snapshot = readIf(join(views, 'snapshot.md')) ?? ''
  const plan = readIf(join(cwd, 'state', 'plan.yaml'))
  const hash = createHash('sha256').update(`${digest}\u0000${board}\u0000${snapshot}`, 'utf8').digest('hex')
  return { ok: true, digest, board, snapshot, plan, hash }
}

/** L1: header + digest + open tasks + plan + last snapshot. One message, composed once. */
export function composeL1(state) {
  const parts = [L1_HEADER, '', state.digest.trim()]
  if (typeof state.board === 'string' && state.board.trim() !== '') parts.push('', ...openTaskLines(state.board, state.snapshot))
  if (typeof state.plan === 'string' && state.plan.trim() !== '') {
    parts.push('', '## Plan', '', state.plan.trim())
  }
  if (state.snapshot.trim() !== '') {
    parts.push('', '## Last snapshot', '', state.snapshot.trim())
  }
  return parts.join('\n')
}

/**
 * The task statuses whose titles the block lists, the same three the digest's "Open work" calls
 * open: `open`, `active` and `review` (`plugins/project-state/lib/core.mjs:29` names all six
 * task statuses). A `blocked` task is not listed, but it is still UNCLOSED for the counter.
 */
const OPEN_STATUSES = ['open', 'active', 'review']

/** The task statuses that are closed; every other status is an unclosed task. */
const CLOSED_STATUSES = ['done', 'cancelled']

/** How many titles the open-tasks section lists before it says how many are left. */
export const OPEN_TASK_ROWS = 12

/**
 * Every task row of `state/views/board.md`, in board order.
 *
 * The board is the projection the feed already reads, and its table is the only row format:
 * `## <status> (<count>)` opens a section, then `| TASK-nnn | title | reqs | steps | chore |`
 * rows follow.
 *
 * @param {string} board - the board projection's text.
 * @returns {{id: string, title: string, status: string}[]}
 */
function boardTasks(board) {
  const tasks = []
  let status = null
  for (const line of String(board ?? '').split('\n')) {
    const section = /^##\s+(\S+)\s+\((\d+)\)\s*$/.exec(line.trim())
    if (section !== null) {
      status = section[1]
      continue
    }
    if (status === null) continue
    const row = /^\|\s*(TASK-\d+)\s*\|\s*(.*?)\s*\|/.exec(line)
    if (row !== null) tasks.push({ id: row[1], title: row[2], status })
  }
  return tasks
}

/**
 * The agents the ledger records as working, read from the snapshot projection's own line
 * (`- active agents: N`, rendered by project-state from the task rows' session statuses). It is
 * the ledger's record, not a live probe: a session that has settled reads as not working.
 *
 * @param {string} snapshot - the snapshot projection's text.
 * @returns {number}
 */
export function recordedAgents(snapshot) {
  const match = /^- active agents:\s*(\d+)\s*$/m.exec(String(snapshot ?? ''))
  return match === null ? 0 : Number(match[1])
}

/**
 * The `## Open tasks` block: one counter line with the three figures the owner named, then the
 * titles of the open tasks with their status, at most `OPEN_TASK_ROWS` of them and a `+N more`
 * line when the board holds more. An empty board says so instead of leaving the heading alone.
 *
 * The counter reads `unclosed: N, active: A, agents: G`:
 *   - unclosed - every task that is not done and not cancelled (blocked included);
 *   - active   - the tasks whose status is exactly `active`;
 *   - agents   - the sessions the ledger records as still working, from the snapshot's own
 *                `- active agents:` line, not a live runtime probe.
 *
 * @param {string} board - the board projection's text.
 * @param {string} snapshot - the snapshot projection's text (the agents figure).
 * @returns {string[]} the block's lines, without the blank line that separates it from the rest.
 */
export function openTaskLines(board, snapshot = '') {
  const tasks = boardTasks(board)
  const open = tasks.filter((task) => OPEN_STATUSES.includes(task.status))
  const unclosed = tasks.filter((task) => !CLOSED_STATUSES.includes(task.status)).length
  const active = tasks.filter((task) => task.status === 'active').length
  const lines = ['## Open tasks', '', `unclosed: ${unclosed}, active: ${active}, agents: ${recordedAgents(snapshot)}`]
  if (open.length === 0) return [...lines, '', 'no open tasks']
  lines.push('')
  for (const task of open.slice(0, OPEN_TASK_ROWS)) lines.push(`- ${task.id} [${task.status}] ${task.title}`)
  if (open.length > OPEN_TASK_ROWS) lines.push(`- +${open.length - OPEN_TASK_ROWS} more (state/views/board.md)`)
  return lines
}

/** The open-work bullets of the digest, used as the body of a delta. */
function openWork(digest) {
  const lines = digest.split('\n')
  const start = lines.findIndex((line) => line.trim() === '## Open work')
  if (start < 0) return []
  const bullets = []
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break
    if (line.trim().startsWith('- ')) bullets.push(line.trim())
  }
  return bullets.slice(0, 8)
}

/** The counts block of the snapshot (`- REQ: …` …), for a compact delta. */
function counts(snapshot) {
  return snapshot.split('\n').filter((line) => /^- (REQ|DECISION|TASK|TEST|last journal event):/.test(line.trim())).map((line) => line.trim())
}

/**
 * Truncate on a line boundary with a fixed marker.
 *
 * A section header whose rows were cut is dropped with them: keeping `## Counts` alone (and
 * the blank line after it) is the artefact a reader saw as "a header with nothing under it",
 * and it says less than the marker that follows.
 */
function cap(text, limit) {
  if (utf8(text) <= limit) return text
  const marker = '\n[state delta truncated; read state/views/digest.md]'
  const budget = limit - utf8(marker)
  const kept = []
  for (const line of text.split('\n')) {
    if (utf8(`${kept.join('\n')}\n${line}`) > budget) break
    kept.push(line)
  }
  // Work back over what is left: trailing blanks, then a header left with no rows under it. A
  // section whose preamble survived but none of its rows did (its counts line, say) goes too,
  // so the marker never follows a heading that promises rows the cut removed.
  for (;;) {
    while (kept.length > 0) {
      const last = kept[kept.length - 1]
      if (last.trim() === '' || last.startsWith('## ')) kept.pop()
      else break
    }
    const header = kept.findLastIndex((line) => line.startsWith('## '))
    if (header < 0) break
    // A section is complete when at least one row survived: a dash row, or the empty-board
    // sentence that stands in for rows. Its counts line alone is not a row.
    const hasRows = kept.slice(header + 1).some((line) => {
      const text = line.trim()
      return text.startsWith('- ') || text === 'no open tasks'
    })
    if (hasRows) break
    kept.length = header
  }
  return `${kept.join('\n')}${marker}`
}

/**
 * L2: one aggregated delta for a turn, never more than `limit` bytes.
 *
 * @param {{snapshot: string, digest: string, board: string, hash: string}} state - the state NOW.
 * @param {string} previousHash - the hash the session already saw.
 */
export function composeL2(state, previousHash) {
  const parts = [L2_HEADER, '', `views hash: ${String(previousHash).slice(0, 8)} -> ${state.hash.slice(0, 8)}`]
  const countsLines = counts(state.snapshot)
  if (countsLines.length > 0) parts.push('', '## Counts', '', ...countsLines)
  const bullets = openWork(state.digest)
  if (bullets.length > 0) parts.push('', '## Open work', '', ...bullets)
  if (typeof state.board === 'string' && state.board.trim() !== '') parts.push('', ...openTaskLines(state.board, state.snapshot))
  if (parts.length <= 4) parts.push('', 'state/views changed; read state/views/digest.md for the current summary.')
  return cap(parts.join('\n'), L2_LIMIT_BYTES)
}

/**
 * A complete UserMessage for `agent.inject()`: model-visible, logged by the harness as
 * user/message.
 *
 * WHY THE `id` IS MANDATORY. `inject()` takes an already-built `UserMessage` and the session
 * persists it verbatim; it never stamps an identity of its own. `createUserMessage()` in
 * `@deepseek-ai/dsh-llm` is where that identity comes from, and this plugin composes its
 * message without importing the harness LLM package — so it must supply the id itself. A
 * message without one is written to the log anyway and every later load is refused with
 * `session event at seq N lacks an identified message`, which takes the whole session (not
 * just this message) down with it.
 */
export function stateMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'state-feed', form: 'snapshot', sections: [{ name: 'state-feed', text }] },
  }
}
