/**
 * PURPOSE
 *   The filesystem half of the case library: one JSON file per case, a validated id that is
 *   also a file name, a symlink guard, an atomic writer and a tolerant reader. It lives outside
 *   test-cases.mjs so the runner CLI and the tests can read and write cases without the DSH tool
 *   runtime, and so the writer has exactly one implementation (the tools, the panel command and
 *   the CLI all end up here).
 *
 * INPUTS / OUTPUTS
 *   libraryDir(cwd, config) -> absolute library root (`docs/cases` by default).
 *   readCase(dir, id) -> { record, path }; a refusal for a missing, unreadable, mismatched or
 *   escaping case. writeCase(dir, record) -> path (atomic temp + rename, validated id).
 *   readCases(dir) -> every parseable record, and one `{ id, error }` row per unreadable file so
 *   a single broken file cannot hide the library (list, suite and gate use this).
 *   Case files carry `schemaVersion: 1`; new fields are additive.
 *
 * KEYWORDS
 *   case store, atomic write, symlink guard, case id, docs/cases, tolerant read
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A refusal is a value with a stable code; the tool layer never sees an exception. */
export class Refusal extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.code = code
    this.extra = extra
  }
}

/** Case ids are file names: one lowercase kebab segment, never a path. */
export const CASE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Absolute library root for a workspace. */
export function libraryDir(cwd, config) {
  const dir = typeof config?.dir === 'string' && config.dir !== '' ? config.dir : 'docs/cases'
  return join(cwd, ...dir.split('/').filter(Boolean))
}

/**
 * Validate a requested case id.
 *
 * A case id is a FILE NAME, not a path. The first version joined the raw string, so
 * `id: "../outside"` read a JSON file outside the library and a crafted `record.id` wrote one
 * there. The grammar allows no slash, dot or separator, and the caller's id is checked against
 * the stored `record.id` on read, so a renamed file cannot smuggle a different id in.
 */
export function safeCaseId(id) {
  if (typeof id !== 'string' || !CASE_ID.test(id)) {
    throw new Refusal('INVALID_CASE_ID', `"${String(id).slice(0, 80)}" is not a case id; expected ^[a-z0-9]+(-[a-z0-9]+)*$`)
  }
  return id
}

/** Resolve a case path inside the library, refusing a symlink that leaves it. */
export function casePath(dir, id) {
  safeCaseId(id)
  const path = join(dir, `${id}.json`)
  let realDir
  try {
    realDir = realpathSync(dir)
  } catch {
    return join(dir, `${id}.json`)
  }
  try {
    const realFile = realpathSync(path)
    if (realFile !== join(realDir, `${id}.json`)) {
      throw new Refusal('CASE_OUTSIDE_LIBRARY', `case "${id}" resolves outside the library (${realFile})`)
    }
    return realFile
  } catch (error) {
    if (error instanceof Refusal) throw error
    // The file does not exist yet (or the symlink is dangling): the validated join is the path.
    return join(realDir, `${id}.json`)
  }
}

/** Read one case file; a missing file is a refusal, not an empty case. */
export function readCase(dir, id) {
  const path = casePath(dir, id)
  if (!existsSync(path)) throw new Refusal('CASE_NOT_FOUND', `no case "${id}" in ${dir}`)
  let record
  try {
    record = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Refusal('CASE_UNREADABLE', `${path}: ${error.message}`)
  }
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new Refusal('CASE_UNREADABLE', `${path}: not a case object`)
  }
  if (record.id !== id) {
    throw new Refusal('CASE_ID_MISMATCH', `${path} holds id "${String(record.id).slice(0, 80)}", not "${id}"`)
  }
  return { record, path }
}

/** Atomic write: a reader never sees a half-written case, and a write failure is a refusal. */
export function writeCase(dir, record) {
  safeCaseId(record?.id)
  const path = casePath(dir, record.id)
  const temp = `${path}.${process.pid}.tmp`
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    renameSync(temp, path)
  } catch (error) {
    throw new Refusal('CASE_WRITE_FAILED', `${path}: ${error.message}`)
  }
  return path
}

/** Case ids present in the library (file names only; README/tests/fixtures are not cases). */
export function listCaseIds(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -'.json'.length))
}

/**
 * Every parseable case, plus one error row per unreadable file.
 *
 * A malformed file is a FINDING, not the end of the sweep: `case_list`, `case_suite` and
 * `case_gate` must not be blinded by one broken record.
 */
export function readCases(dir) {
  const cases = []
  for (const id of listCaseIds(dir)) {
    try {
      cases.push({ record: readCase(dir, id).record })
    } catch (error) {
      cases.push({ id, error: error instanceof Refusal ? error.code : 'CASE_UNREADABLE', message: String(error?.message ?? error) })
    }
  }
  return cases
}

/** Unlink one case file after the caller has decided to remove it. */
export function removeCaseFile(dir, id) {
  const path = casePath(dir, id)
  unlinkSync(path)
  return path
}

/** Append one audit line to an append-only JSONL file inside the library. */
export function appendAudit(dir, file, entry) {
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, file), `${JSON.stringify(entry)}\n`, 'utf8')
}
