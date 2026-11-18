/**
 * PURPOSE
 *   Make a session log readable again after something wrote a `user/message` event whose
 *   message has no `id`. The harness persists an injected message verbatim — the identity is
 *   stamped by `createUserMessage()` in `@deepseek-ai/dsh-llm`, not by `agent.inject()` — so a
 *   producer that composes its own message object writes an unidentified record. Nothing
 *   refuses it at write time; the refusal comes later, at load time, from
 *   `adoptSessionEvent()`: `session event at seq N lacks an identified message`. One such
 *   event makes the WHOLE session refuse to open, so the cost of the defect is the session,
 *   not the message.
 *
 *   The state feed (`@cc/dsh-state-feed` 0.1.1) was exactly that producer. The plugin is
 *   fixed, but sessions written before the fix stay unreadable until the stored record gains
 *   the identity it should have carried; nothing else about the record is wrong, so nothing
 *   else is touched.
 *
 * WHY REWRITE THE FILE AND NOT PATCH THE LOADER
 *   A tolerant loader would have to invent an identity for a message the model already read,
 *   and would leave every such log permanently non-canonical. Adding the missing field to the
 *   stored record restores the log to the shape the format has always required.
 *
 * WHY THE FRAMES ARE WALKED AND PRESERVED ONE BY ONE
 *   A stored log is many Zstandard frames appended one after another, and the ENCODING CARRIES
 *   MEANING in two places:
 *     - the FIRST frame must be exactly one line, the session header (`assertZstdHeaderFrame`
 *       refuses anything else with "first frame is not exactly one header line");
 *     - every later frame holds whole event lines.
 *   Node's one-shot `zstdDecompressSync` decodes only the first frame and stops (measured on a
 *   real 4 MB log: 206 bytes out of 4 049 285), so the frames are located without decompressing
 *   their blocks and each is decoded on its own, mirroring `dsh-session-persistence-jsonl`.
 *   A repair re-encodes ONLY the frames that contain a rewritten line and copies every other
 *   frame byte for byte — including the header frame, whose one-line shape a naive
 *   decode-all-then-encode-once rewrite destroys. That failure is silent: the header read fails,
 *   `listArtifacts` catches the corruption and drops the artifact, so the session disappears from
 *   the sidebar instead of reporting an error.
 *
 * INPUTS
 *   <command>              scan (default) | repair
 *                          `scan` reports and exits 1 when a log needs repair, so it can be a
 *                          check; `repair` needs --apply to write anything.
 *   --home <path>          harness home. Default $DSH_HOME, else ~/.npm/dsh.
 *   --session <id>         repair only this session (repeatable; a substring of the id is enough).
 *   --apply                write the repair (without it `repair` is a dry run).
 *   --backup <path>        where originals are copied. Default <home>/sessions-backup.
 *   --max-age-minutes <n>  never rewrite a log written more recently than this: a fresh mtime
 *                          means a live session is appending to it. Default 60; `0` disables.
 *   --json                 print one JSON object instead of the human lines.
 *   Environment: nothing else.
 *
 * OUTPUTS
 *   prints per-session findings and a summary; with --apply, rewrites the affected
 *   `session.v4.jsonl.zstd` files in place after copying the original under the backup root.
 *   Exit 0 = nothing to do (scan) or everything repaired; 1 = defects found (scan) or a repair
 *   failed or was refused; 2 = usage error.
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A log whose final Zstandard frame is incomplete (a crash mid-append) is REPORTED, never
 *     rewritten: its tail is unrecoverable here and truncating it would silently drop history.
 *   - A log whose first frame is not exactly one header line (a merged header) is REPORTED and
 *     left alone: restoring the split is a different repair, and guessing which line was the
 *     header would rewrite encoding the writer never produced.
 *   - A log modified within --max-age-minutes is skipped with the reason, so repairing cannot
 *     race the writer that is appending to it.
 *   - Every rewritten event is compared with the original after the id is stripped; a mismatch
 *     aborts that session and leaves the original in place.
 *   - Everything except the added `id` is preserved: untouched frames keep their exact bytes,
 *     untouched lines keep their exact text, and the rewritten frame keeps its line count.
 *   - The id is a fresh `randomUUID()`, never a value derived from the event, so two repaired
 *     logs cannot share one identity.
 *   - A session whose id matches no stored log is a usage error, not a silent no-op.
 */

import { randomUUID } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeSync } from 'node:fs'
import { constants as zlibConstants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const ZSTD_MAGIC = 0xfd2fb528
const SESSION_LOG = 'session.v4.jsonl.zstd'

/**
 * Locate complete Zstandard frames without decompressing their blocks. An invalid complete
 * structure rejects; EOF inside the final frame returns that frame's start instead of failing,
 * so a torn tail is reported rather than mistaken for an unreadable file.
 *
 * @param {Buffer} buffer - the whole session file.
 * @returns {{frames: Array<{start: number, end: number}>, tornStart?: number}}
 */
function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid frame magic at byte ${offset}`)
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (offset > buffer.length) return { frames, tornStart: start }
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`)
      offset += blockType === 1 ? 1 : blockSize
      if (offset > buffer.length) return { frames, tornStart: start }
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/** Read one stored log frame by frame; `torn` reports an incomplete final frame. */
function decodeFrames(path) {
  const raw = readFileSync(path)
  const { frames, tornStart } = scanZstdFrames(raw)
  const decoded = frames.map((frame) => {
    const bytes = raw.subarray(frame.start, frame.end)
    return { bytes: Buffer.from(bytes), text: zstdDecompressSync(bytes).toString('utf8') }
  })
  return { frames: decoded, torn: tornStart !== undefined }
}

/** Whether a frame is exactly one line: the shape the header frame must keep. */
function isSingleLine(text) {
  return text.length > 0 && text.indexOf('\n') === text.length - 1
}

/** The message an event carries, for the event types whose payload is one. */
function messageOf(event) {
  const data = event?.data
  if (data === null || typeof data !== 'object') return null
  if (event.type === 'user/message') return data
  const message = data.message
  return message !== null && typeof message === 'object' ? message : null
}

/** Whether a message carries the identity the load-time validator requires. */
function identified(message) {
  return typeof message?.id === 'string' && message.id !== ''
}

/** Split one frame's plaintext into line entries, keeping each original line for byte fidelity. */
function linesOf(text) {
  if (text === '') return []
  const parts = text.split('\n')
  if (parts[parts.length - 1] === '') parts.pop()
  return parts.map((raw) => {
    let event = null
    let error = null
    try {
      event = JSON.parse(raw)
    } catch (cause) {
      error = String(cause.message ?? cause)
    }
    const message = event === null ? null : messageOf(event)
    return { raw, event, error, needsId: message !== null && !identified(message) }
  })
}

/** Encode one frame's lines as a single checksummed frame, the shape the writer produces. */
function encodeFrame(entries) {
  const text = entries.map((entry) => entry.raw).join('\n') + '\n'
  return zstdCompressSync(Buffer.from(text, 'utf8'), { params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 } })
}

/** Return the event with the identity removed, for the before/after comparison. */
function withoutId(event) {
  const copy = structuredClone(event)
  const message = messageOf(copy)
  if (message !== null) delete message.id
  return copy
}

/** Add a fresh identity to one event, leaving every other field alone. */
function withFreshId(event) {
  const copy = structuredClone(event)
  messageOf(copy).id = randomUUID()
  return copy
}

/** Write a file so a reader sees either the old bytes or the new ones, never a half file. */
function writeAtomic(path, payload) {
  const temporary = join(dirname(path), `.${basename(path)}.repair-${randomUUID()}.tmp`)
  const handle = openSync(temporary, 'wx', 0o600)
  try {
    writeSync(handle, payload)
    fsyncSync(handle)
  } finally {
    closeSync(handle)
  }
  renameSync(temporary, path)
}

/** Every stored session log under the harness home. */
function sessionLogs(home) {
  const root = join(home, 'sessions')
  if (!existsSync(root)) return []
  const logs = []
  for (const project of readdirSync(root)) {
    const projectDir = join(root, project)
    let entries
    try {
      entries = readdirSync(projectDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('session-')) continue
      const path = join(projectDir, entry.name, SESSION_LOG)
      if (!existsSync(path)) continue
      logs.push({ project, id: entry.name, path, mtimeMs: statSync(path).mtimeMs })
    }
  }
  return logs
}

/** Analyse one log without writing: what is wrong, and whether a repair is allowed. */
function inspect(log, options) {
  const report = { project: log.project, id: log.id, path: log.path, missing: [], damaged: 0, torn: false, header: true, fresh: false, events: 0, frames: 0 }
  let decoded
  try {
    decoded = decodeFrames(log.path)
  } catch (error) {
    report.fatal = String(error.message ?? error)
    return report
  }
  report.torn = decoded.torn
  report.frames = decoded.frames.length
  report.header = decoded.frames.length > 0 && isSingleLine(decoded.frames[0].text)
  // Lines are deliberately not retained: a whole-store scan touches ~1 000 logs, and holding
  // every decoded event string at once exhausts the default heap (measured: OOM at 127 s).
  for (const [index, frame] of decoded.frames.entries()) {
    if (index === 0) continue
    for (const entry of linesOf(frame.text)) {
      if (entry.error !== null) report.damaged += 1
      if (entry.event !== null) report.events += 1
      if (entry.needsId) report.missing.push(entry.event.seq)
    }
  }
  report.ageMinutes = (Date.now() - log.mtimeMs) / 60000
  report.fresh = options.maxAgeMinutes > 0 && report.ageMinutes < options.maxAgeMinutes
  return report
}

/** Rewrite one inspected log: fresh ids, a backup, an atomic replace, then a self-check. */
function repairLog(report, options) {
  // Re-read instead of trusting the scan: a log can change between scan and repair, and the
  // rewrite must describe the file as it is now.
  const decoded = decodeFrames(report.path)
  assert.ok(decoded.frames.length > 0 && isSingleLine(decoded.frames[0].text), `session ${report.id}: first frame is not exactly one header line; refusing to rewrite the encoding`)

  const missingNow = []
  for (const [index, frame] of decoded.frames.entries()) {
    if (index === 0) continue
    missingNow.push(...linesOf(frame.text).filter((entry) => entry.needsId).map((entry) => entry.event.seq))
  }
  assert.deepEqual(missingNow, report.missing, `session ${report.id}: the log changed between scan and repair (${report.missing.length} -> ${missingNow.length} unidentified); rerun`)

  const parts = []
  let rewritten = 0
  for (const [index, frame] of decoded.frames.entries()) {
    if (index === 0) {
      parts.push(frame.bytes)
      continue
    }
    const entries = linesOf(frame.text)
    if (!entries.some((entry) => entry.needsId)) {
      parts.push(frame.bytes)
      continue
    }
    for (const entry of entries) {
      if (!entry.needsId) continue
      const repaired = withFreshId(entry.event)
      assert.deepEqual(withoutId(repaired), entry.event, `session ${report.id}: repair would change more than the identity at seq ${entry.event.seq}`)
      entry.raw = JSON.stringify(repaired)
      entry.event = repaired
      entry.needsId = false
      rewritten += 1
    }
    parts.push(encodeFrame(entries))
  }
  const payload = Buffer.concat(parts)

  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  const backupDir = join(options.backup, stamp, report.project, report.id)
  mkdirSync(backupDir, { recursive: true })
  copyFileSync(report.path, join(backupDir, SESSION_LOG))
  writeAtomic(report.path, payload)

  const after = inspect({ project: report.project, id: report.id, path: report.path, mtimeMs: Date.now() }, { ...options, maxAgeMinutes: 0 })
  const problem = after.fatal !== undefined ? after.fatal
    : !after.header ? 'first frame is not exactly one header line'
      : after.missing.length > 0 ? `${after.missing.length} unidentified message(s)`
        : after.damaged > 0 ? `${after.damaged} unparseable line(s)`
          : after.torn ? 'incomplete final frame'
            : after.frames !== report.frames ? `frame count changed ${report.frames} -> ${after.frames}`
              : after.events !== report.events ? `event count changed ${report.events} -> ${after.events}`
                : null
  if (problem !== null) {
    copyFileSync(join(backupDir, SESSION_LOG), report.path)
    throw new Error(`session ${report.id}: repair did not verify (${problem}); original restored`)
  }
  return { backup: backupDir, rewritten }
}

/** Parse argv; an unknown flag or a bad value is a usage error. */
function parseArgs(argv) {
  const options = { command: 'scan', home: process.env.DSH_HOME || join(homedir(), '.npm', 'dsh'), sessions: [], apply: false, backup: null, maxAgeMinutes: 60, json: false }
  const rest = [...argv]
  if (rest[0] !== undefined && !rest[0].startsWith('-')) options.command = rest.shift()
  while (rest.length > 0) {
    const flag = rest.shift()
    if (flag === '--apply') options.apply = true
    else if (flag === '--json') options.json = true
    else if (flag === '--home') options.home = rest.shift()
    else if (flag === '--backup') options.backup = rest.shift()
    else if (flag === '--session') options.sessions.push(rest.shift())
    else if (flag === '--max-age-minutes') {
      const value = Number(rest.shift())
      if (!Number.isFinite(value) || value < 0) throw new Error('--max-age-minutes needs a non-negative number')
      options.maxAgeMinutes = value
    } else throw new Error(`unknown argument ${JSON.stringify(flag)}`)
  }
  for (const key of ['home', 'backup']) if (options[key] === undefined) throw new Error(`--${key} needs a value`)
  if (options.sessions.some((id) => id === undefined)) throw new Error('--session needs a value')
  if (options.command !== 'scan' && options.command !== 'repair') throw new Error(`unknown command ${JSON.stringify(options.command)}`)
  options.backup ??= join(options.home, 'sessions-backup')
  return options
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`session-repair: ${String(error.message ?? error)}\n`)
    return 2
  }
  const all = sessionLogs(options.home)
  const selected = options.sessions.length === 0 ? all : all.filter((log) => options.sessions.some((needle) => log.id.includes(needle)))
  if (options.sessions.length > 0 && selected.length === 0) {
    process.stderr.write(`session-repair: no stored log matches ${options.sessions.join(', ')} under ${join(options.home, 'sessions')}\n`)
    return 2
  }

  const reports = selected.map((log) => inspect(log, options))
  const actionable = reports.filter((report) => report.fatal === undefined && report.header && report.missing.length > 0)
  const result = { command: options.command, scanned: reports.length, needingRepair: actionable.length, repaired: [], skipped: [], failed: [], torn: [], damaged: [], merged: [] }

  for (const report of reports) {
    if (report.fatal !== undefined) result.failed.push({ id: report.id, reason: report.fatal })
    else if (!report.header) result.merged.push({ id: report.id })
    else if (report.torn) result.torn.push({ id: report.id })
  }

  for (const report of actionable) {
    if (report.fresh) {
      result.skipped.push({ id: report.id, reason: `written ${report.ageMinutes.toFixed(1)} min ago (--max-age-minutes ${options.maxAgeMinutes})` })
      continue
    }
    if (options.command !== 'repair' || !options.apply) continue
    try {
      const { backup, rewritten } = repairLog(report, options)
      result.repaired.push({ id: report.id, project: report.project, seqs: report.missing, events: report.events, frames: report.frames, rewritten, backup })
    } catch (error) {
      result.failed.push({ id: report.id, reason: String(error.message ?? error) })
    }
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } else {
    for (const report of reports) {
      if (report.fatal === undefined && report.header && !report.torn && report.missing.length === 0) continue
      const detail = report.fatal !== undefined
        ? `unreadable: ${report.fatal}`
        : !report.header ? 'first frame is not exactly one header line (merged header): left alone'
          : report.missing.length > 0
            ? `${report.missing.length} unidentified message(s) at seq ${report.missing.join(', ')}`
            : 'incomplete final frame'
      process.stdout.write(`${report.project}/${report.id}: ${detail}\n`)
    }
    for (const row of result.repaired) process.stdout.write(`repaired ${row.id} (${row.rewritten} event(s): seq ${row.seqs.join(', ')}, ${row.frames} frame(s) kept); backup ${row.backup}\n`)
    for (const row of result.skipped) process.stdout.write(`skipped ${row.id}: ${row.reason}\n`)
    for (const row of result.failed) process.stdout.write(`FAILED ${row.id}: ${row.reason}\n`)
    process.stdout.write(`session-repair: ${result.scanned} log(s), ${result.needingRepair} need repair, ${result.repaired.length} repaired, ${result.skipped.length} skipped, ${result.failed.length} failed\n`)
  }

  if (result.failed.length > 0) return 1
  if (options.command === 'scan' && (result.needingRepair > 0 || result.merged.length > 0)) return 1
  if (options.command === 'repair' && result.needingRepair > 0 && result.repaired.length === 0) return 1
  return 0
}

process.exitCode = main()
