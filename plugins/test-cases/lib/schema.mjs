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
 *
 * KEYWORDS
 *   case id, slug, drift, surface hash, stale, missing test, pure rule
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

/** Stable, filesystem-safe id from a title. */
export function slugify(title) {
  const base = String(title)
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
    .slice(0, 60)
  return base === '' ? 'case' : base
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
  if (missingTest) return { status: 'stale', changedFiles, missingTest, reason: `test file missing: ${record.testPath}; the case degrades to documented-only` }
  if (changedFiles.length > 0) return { status: 'stale', changedFiles, missingTest, reason: `surface files changed since lastVerified: ${changedFiles.join(', ')}` }
  return { status: null, changedFiles, missingTest, reason: null }
}
