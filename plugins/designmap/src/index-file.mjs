/**
 * The scene bundle index.
 *
 * The panel reads files through a read-only workspace API and cannot list a
 * directory, so `designmap/out/index.json` is the only way it can discover which
 * views exist and which scene file belongs to each. Core produces it together with
 * the scenes; the host (M3) decides when to call this.
 *
 * The index is deterministic: rows are sorted by view id, paths are relative to the
 * designmap directory, and it carries no timestamps (only input/scene hashes), so two
 * runs over the same workspace produce byte-identical index bytes as well.
 */
import { sha256, toJson } from './canonical.mjs'
import { renderView } from './render.mjs'

export const INDEX_SCHEMA_VERSION = 1
export const INDEX_FILE = 'index.json'

/**
 * Build the index object from rendered views.
 * @param root0.views - validated views document.
 * @param root0.entries - Map viewId -> `{sceneJson, sceneHash, bytes}`.
 * @param root0.hashes - `{model, views, overlays}` file hashes (null when absent).
 */
export function buildIndex({ views, entries, hashes }) {
  const rows = views.views.map(view => {
    const entry = entries.get(view.id)
    if (entry === undefined) throw new Error(`designmap index: no scene was rendered for view "${view.id}"`)
    return {
      viewId: view.id,
      title: view.title ?? '',
      level: view.level,
      direction: view.direction ?? 'LR',
      parent: view.parent ?? null,
      scenePath: `out/${view.id}.scene.json`,
      sceneHash: entry.sceneHash,
      bytes: entry.bytes,
    }
  }).sort((left, right) => (left.viewId < right.viewId ? -1 : left.viewId > right.viewId ? 1 : 0))
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    views: rows,
    modelHash: hashes.model ?? null,
    viewsHash: hashes.views ?? null,
    overlaysHash: hashes.overlays ?? null,
  }
}

/**
 * Render every view, write the scene files and the index — two phases, so a refusal
 * for any view leaves the directory untouched (NFR-2 spirit).
 * @returns `{index, indexJson, indexHash, rendered}`
 */
export async function renderAll({ workspace, logger, staleNodeIds = [] }) {
  const viewsRead = workspace.readViews()
  const views = viewsRead.views
  const model = workspace.readModel()
  const overlays = workspace.readOverlays()
  const entries = new Map()
  const rendered = []

  // Phase 1: render everything in memory. A refusal on any view throws before a single
  // byte is written, so the directory cannot end up with a half-updated bundle.
  for (const view of views.views) {
    const result = await renderView({
      model: model.model,
      views,
      overlays: overlays.overlays,
      viewId: view.id,
      staleNodeIds,
      logger,
    })
    entries.set(view.id, { sceneJson: result.sceneJson, sceneHash: result.sceneHash, bytes: result.bytes })
    rendered.push({
      viewId: view.id,
      scene: result.scene,
      sceneHash: result.sceneHash,
      bytes: result.bytes,
      layout: result.layout,
      lint: result.lint,
      merge: { applied: result.merge.applied, gc: result.merge.gc.length },
    })
  }

  // Phase 2: write the scenes and the index the panel will read.
  const index = buildIndex({
    views,
    entries,
    hashes: { model: model.hash, views: viewsRead.hash, overlays: overlays.hash },
  })
  const indexJson = toJson(index)
  for (const [viewId, entry] of entries) workspace.writeScene(viewId, entry.sceneJson)
  workspace.writeIndex(indexJson)
  return { index, indexJson, indexHash: sha256(indexJson), rendered }
}
