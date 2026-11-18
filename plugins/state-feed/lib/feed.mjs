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

/** L1: header + digest + plan + last snapshot. One message, composed once. */
export function composeL1(state) {
  const parts = [L1_HEADER, '', state.digest.trim()]
  if (typeof state.plan === 'string' && state.plan.trim() !== '') {
    parts.push('', '## Plan', '', state.plan.trim())
  }
  if (state.snapshot.trim() !== '') {
    parts.push('', '## Last snapshot', '', state.snapshot.trim())
  }
  return parts.join('\n')
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

/** Truncate on a line boundary with a fixed marker. */
function cap(text, limit) {
  if (utf8(text) <= limit) return text
  const marker = '\n[state delta truncated; read state/views/digest.md]'
  const budget = limit - utf8(marker)
  const kept = []
  for (const line of text.split('\n')) {
    if (utf8(`${kept.join('\n')}\n${line}`) > budget) break
    kept.push(line)
  }
  return `${kept.join('\n')}${marker}`
}

/**
 * L2: one aggregated delta for a turn, never more than `limit` bytes.
 *
 * @param {{snapshot: string, digest: string, hash: string}} state - the state NOW.
 * @param {string} previousHash - the hash the session already saw.
 */
export function composeL2(state, previousHash) {
  const parts = [L2_HEADER, '', `views hash: ${String(previousHash).slice(0, 8)} -> ${state.hash.slice(0, 8)}`]
  const countsLines = counts(state.snapshot)
  if (countsLines.length > 0) parts.push('', '## Counts', '', ...countsLines)
  const bullets = openWork(state.digest)
  if (bullets.length > 0) parts.push('', '## Open work', '', ...bullets)
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
