/**
 * `designmap/manifest.json`: the commit and per-node source hashes the model was last
 * synced with. M3 writes it on apply; status reads it to answer "did the code move
 * under the map?".
 *
 * Shape (owner spec / SCENE-CONTRACT stale rule):
 *   { schemaVersion, rev, commit, generatedAt, modelHash,
 *     sourceHashes: { nodeId: "sha256:…" | null } }
 *
 * A node without a `source` is absent from `sourceHashes`; a node whose source file is
 * missing maps to null. The file is written atomically and only when its content
 * actually changes, so an idempotent re-apply leaves it byte-identical.
 *
 * `rev` IS THE DESIGN MAP REVISION the analysis record references (`designRef.mapRev`).
 * It is a MONOTONIC COUNTER OF SEMANTIC MODEL CONTENT, not of writes: it rises by one only
 * when the canonical model differs from the one the previous manifest recorded, so a
 * repeated `designmap_apply`, a re-render, an overlay move or a views-only edit does not
 * move it. `modelHash` is that content hash, and it is what makes the decision reviewable.
 *
 * WHY THE OLD SCENE SEEDS IT. The map used to live in `design.excalidraw`, whose
 * `designMap.rev` had reached 30 when this plugin took over; analysis records already stored
 * `mapRev: 30`. Starting the counter at 1 would make every one of them look drifted, so the
 * first manifest continues from that scene (D3 in docs/analysis/kit-integrity-p0.json).
 * `design.excalidraw` is READ here and nowhere else, only to seed this one value; nothing
 * writes it back.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { canonicalModel, sha256, toJson } from './canonical.mjs'

export const MANIFEST_FILE = 'manifest.json'
export const MANIFEST_SCHEMA_VERSION = 1

/** The retired scene whose `designMap.rev` seeds the first manifest revision. */
export const SEED_SCENE_FILE = 'design.excalidraw'

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

/** Content hash of the canonical (semantic) model: the key the revision moves on. */
export function modelContentHash(model) {
  return sha256(toJson(canonicalModel(model)))
}

/**
 * The revision the retired `design.excalidraw` reached, read once to continue its numbering.
 *
 * A missing/malformed scene is 0: the map starts its own numbering from 1 on the first change.
 */
export function seedRevision(repoRoot) {
  const path = join(repoRoot, SEED_SCENE_FILE)
  if (!existsSync(path)) return 0
  try {
    const rev = JSON.parse(readFileSync(path, 'utf8'))?.designMap?.rev
    return Number.isSafeInteger(rev) && rev >= 0 ? rev : 0
  } catch {
    // A broken legacy scene is not a revision: the manifest starts from 0.
    return 0
  }
}

/**
 * Next revision for `model`.
 *
 * With a previous manifest the content hash decides: same hash keeps `rev`, a different hash
 * bumps it by one. `changed` is only the fallback for a manifest written before `modelHash`
 * existed (upgrade), where the apply engine's own "model written" answer is the only signal.
 *
 * @param options.seed - lazy legacy seed, called only when there is no previous revision.
 */
export function nextRevision({ previous, modelHash, changed = false, seed = () => 0 }) {
  const previousRev = Number.isSafeInteger(previous?.rev) && previous.rev >= 0 ? previous.rev : null
  if (previousRev === null) return seed() + (changed ? 1 : 0)
  if (typeof previous?.modelHash === 'string' && previous.modelHash !== '') {
    return previous.modelHash === modelHash ? previousRev : previousRev + 1
  }
  return previousRev + (changed ? 1 : 0)
}

/**
 * Build the manifest for `model` at `commit`.
 *
 * @param options.previous - the manifest on disk before this apply, or null.
 * @param options.changed - did this apply write the model? Only used when `previous` predates
 *   `modelHash`; the hash is the authority otherwise.
 */
export function buildManifest({ model, repoRoot, commit, generatedAt, previous = null, changed = false }) {
  const modelHash = modelContentHash(model)
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    // The retired scene is read ONLY when there is no revision to continue: an ordinary
    // apply must not touch it at all.
    rev: nextRevision({ previous, modelHash, changed, seed: () => seedRevision(repoRoot) }),
    commit: commit ?? null,
    generatedAt,
    modelHash,
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
    rev: manifest.rev ?? 0,
    commit: manifest.commit ?? null,
    modelHash: manifest.modelHash ?? null,
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
