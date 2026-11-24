/**
 * PURPOSE
 *   The two rules the case library must obey that do not need a DSH context: how a title becomes
 *   a stable id, and what a stored case says about itself after the workspace changed. They live
 *   here, not in the tool module, so a test can import them without pulling `@deepseek-ai/dsh-tools`
 *   (which only resolves inside a profile), and so the drift rule has exactly one implementation.
 *
 * INPUTS / OUTPUTS
 *   slugify(title) -> kebab-case id (never empty).
 *   driftFor(record, workspace, { hash }) -> { status, changedFiles, missingTest, reason }, where
 *   `status` is the next status when it differs from the record's, else null.
 *   testHashOf(record, workspace, { hash }) -> sha256 of the case's test file, or null when the
 *   case is documented-only or has no testPath.
 *   testHashState(record, workspace, { hash }) -> { recorded, actual, ok }: the hash stored when
 *   the case was registered or its test was re-pinned, the hash of the file now, and whether
 *   they are the same bytes. `recorded: null` is a case written before the hash existed.
 *
 * KEYWORDS
 *   case id, slug, drift, surface hash, test hash, stale, missing test, pure rule
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Lowercase hex sha256 of a file, or null when it is absent. */
export function fileHash(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return null
  }
}

/**
 * sha256 of a file's TEXT with CRLF collapsed to LF, or null when it is absent.
 *
 * WHY IT EXISTS. A checkout with `core.autocrlf=true` stores the same lines with different bytes
 * (12 bytes of text become 14). The wrong-product red asks "is this the same check?", and the
 * answer is about the lines: comparing raw bytes refused a legitimate clone of the previous
 * version on Windows. The recorded `testHash` keeps raw bytes on purpose (it binds the run to the
 * exact bytes that executed); this hash is for comparing two checkouts, not for pinning a run.
 */
export function textHash(path) {
  try {
    return createHash('sha256').update(readFileSync(path, 'utf8').replaceAll('\r\n', '\n')).digest('hex')
  } catch {
    return null
  }
}

/**
 * The sha256 of the case's test file, or null when the case has none.
 *
 * WHY A CASE KEEPS IT. The run must execute the bytes the case was registered with. Without a
 * stored hash, a test file edited after the verification leaves the case `verified` over a check
 * nobody ran - the record names a command, not the code it runs.
 */
export function testHashOf(record, workspace, options = {}) {
  const hash = typeof options.hash === 'function' ? options.hash : fileHash
  if (record === null || typeof record !== 'object' || record.automated !== true) return null
  const path = typeof record.testPath === 'string' ? record.testPath.trim() : ''
  if (path === '') return null
  return hash(join(workspace, path))
}

/**
 * Compare the hash stored on the case with the file on disk now.
 *
 * @returns `{ recorded, actual, ok }`; `ok` is true only when a recorded hash exists AND matches.
 *   `recorded === null` means the case predates the hash (legacy): the caller refuses the run
 *   instead of trusting bytes the record never named.
 */
export function testHashState(record, workspace, options = {}) {
  const recorded = typeof record?.testHash === 'string' && record.testHash !== '' ? record.testHash : null
  const actual = testHashOf(record, workspace, options)
  return { recorded, actual, ok: recorded !== null && actual !== null && recorded === actual }
}

/**
 * The ASCII letters this library uses for each letter of the Russian alphabet.
 *
 * WHY A TABLE AND NOT A LIBRARY. A title written in Russian must still become a case id, and no
 * dependency is worth a fixed substitution table. Lowercase only: slugify lowercases first. The
 * soft sign and hard sign are dropped, which is why they map to the empty string.
 */
const CYRILLIC_TO_ASCII = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

/**
 * Stable, filesystem-safe id from a title.
 *
 * A title is not always ASCII. The slug rules below keep only [a-z0-9], so before they run every
 * Cyrillic letter is replaced by the table above; without that step a Russian title loses every
 * letter, every such title collapses to the same id, and a second case cannot be recorded. When
 * nothing transcribable survives (punctuation or an empty title) the id is a short sha1 of the
 * title, so two titles still differ and no stored case can collide on a shared constant.
 * ASCII titles are untouched by the table, so their ids stay byte-identical.
 */
export function slugify(title) {
  const text = String(title)
  const base = text
    .normalize('NFC')
    .toLowerCase()
    .replaceAll(/[\u0400-\u04ff]/gu, (letter) => CYRILLIC_TO_ASCII[letter] ?? '')
    .normalize('NFKD')
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
    .slice(0, 60)
    .replaceAll(/-+$/gu, '')
  return base === '' ? `case-${createHash('sha1').update(text).digest('hex').slice(0, 12)}` : base
}

/**
 * Compute what the library should say about a case now.
 *
 * @param record - A stored case record.
 * @param workspace - Session workspace (absolute).
 * @param options - `{ hash }` override for the file hasher (tests); defaults to {@link fileHash}.
 * @returns `{ status, changedFiles, missingTest, reason }`.
 */
export function driftFor(record, workspace, options = {}) {
  const hash = typeof options.hash === 'function' ? options.hash : fileHash
  const changedFiles = []
  for (const entry of record.surfaceFiles ?? []) {
    const actual = hash(join(workspace, entry.path))
    if (actual === null || actual !== entry.sha256) changedFiles.push(entry.path)
  }
  let missingTest = false
  if (record.automated === true && typeof record.testPath === 'string' && record.testPath !== '') {
    missingTest = !existsSync(join(workspace, record.testPath))
  }
  if (record.status === 'superseded' || record.status === 'deprecated') {
    return { status: null, changedFiles: [], missingTest: false, reason: null }
  }
  // ONLY A VERIFIED (or failed) CASE CAN GO STALE. A changed surface on an `unverified` case is
  // not a regression against anything the case ever claimed: nothing was verified, so "stale"
  // would be a lie about history. The change is still REPORTED (changedFiles), it just does not
  // move the status.
  if (!['verified', 'failing', 'flaky'].includes(record.status)) {
    return { status: null, changedFiles, missingTest, reason: null }
  }
  if (missingTest) return { status: 'stale', changedFiles, missingTest, reason: `test file missing: ${record.testPath}; the case degrades to documented-only` }
  if (changedFiles.length > 0) return { status: 'stale', changedFiles, missingTest, reason: `surface files changed since lastVerified: ${changedFiles.join(', ')}` }
  return { status: null, changedFiles, missingTest, reason: null }
}
