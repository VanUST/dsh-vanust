/**
 * `designmap/manifest.json`: the commit and per-node source hashes the model was last
 * synced with. M3 writes it on apply; status reads it to answer "did the code move
 * under the map?".
 *
 * Shape (owner spec / SCENE-CONTRACT stale rule):
 *   { schemaVersion: 1, commit, generatedAt, sourceHashes: { nodeId: "sha256:…" | null } }
 *
 * A node without a `source` is absent from `sourceHashes`; a node whose source file is
 * missing maps to null. The file is written atomically and only when its content
 * actually changes, so an idempotent re-apply leaves it byte-identical.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

export const MANIFEST_FILE = 'manifest.json'
export const MANIFEST_SCHEMA_VERSION = 1

/** SHA-256 of a file's bytes as `sha256:<hex>`, or null when the file is absent. */
export function hashFile(path) {
  if (!existsSync(path)) return null
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
}

/** Resolve a repo-relative source path without letting it escape the repo root. */
export function resolveSource(repoRoot, source) {
  if (typeof source !== 'string' || source === '') return null
  const absolute = resolve(repoRoot, source)
  const rel = relative(repoRoot, absolute)
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return absolute
}

/** Per-node source hashes for the current tree. */
export function sourceHashes(model, repoRoot) {
  const hashes = {}
  for (const node of model.nodes) {
    if (node.source === null || node.source === undefined) continue
    const absolute = resolveSource(repoRoot, node.source)
    hashes[node.id] = absolute === null ? null : hashFile(absolute)
  }
  return hashes
}

/** Build the manifest for `model` at `commit`. */
export function buildManifest({ model, repoRoot, commit, generatedAt }) {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    commit: commit ?? null,
    generatedAt,
    sourceHashes: sourceHashes(model, repoRoot),
  }
}

/** Read the manifest; a missing file is `{manifest: null}`, a malformed one carries an error. */
export function readManifest(designmapDir) {
  const path = join(designmapDir, MANIFEST_FILE)
  if (!existsSync(path)) return { manifest: null, text: null, path, missing: true }
  const text = readFileSync(path, 'utf8')
  try {
    const manifest = JSON.parse(text)
    return { manifest, text, path, missing: false }
  } catch (error) {
    return { manifest: null, text, path, missing: false, malformed: error.message }
  }
}

/** Content equality that ignores `generatedAt` (used to keep idempotent writes byte-stable). */
export function sameManifestContent(left, right) {
  if (left === null || right === null) return left === right
  const strip = manifest => JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    commit: manifest.commit ?? null,
    sourceHashes: Object.fromEntries(Object.entries(manifest.sourceHashes ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))),
  })
  return strip(left) === strip(right)
}

/** Atomically write the manifest, unless the content is already identical. */
export function writeManifest(designmapDir, manifest) {
  const path = join(designmapDir, MANIFEST_FILE)
  const text = `${JSON.stringify(manifest, null, 2)}\n`
  mkdirSync(dirname(path), { recursive: true })
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (existing === text) return { path, written: false }
  try {
    const current = existing === null ? null : JSON.parse(existing)
    if (sameManifestContent(current, manifest)) return { path, written: false }
  } catch {
    // A malformed manifest is replaced: apply is the writer of record.
  }
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, text, 'utf8')
  renameSync(temporary, path)
  return { path, written: true }
}
