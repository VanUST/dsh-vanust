#!/usr/bin/env node
/**
 * Render a designmap workspace and print the evidence the acceptance asks for: scene
 * hashes, layout ms/nodes, lint summary, merge GC.
 *
 * Modes:
 *   node bin/render.mjs <designmapDir> [viewId] [--write] [--log]
 *       render one view (default: the first view in views.yaml)
 *   node bin/render.mjs <designmapDir> --index [--log]
 *       render every view, write all scene files and `out/index.json` (the panel's
 *       only way to discover scenes: it cannot list a directory)
 *
 * Exit code 1 on a structured refusal, 2 on an internal failure.
 */
import { createWorkspace } from '../src/workspace.mjs'
import { renderView } from '../src/render.mjs'
import { renderAll } from '../src/index-file.mjs'
import { DesignmapRefusal } from '../src/schema.mjs'
import { createLogger } from '../src/log.mjs'

const [, , workspaceRoot, ...rest] = process.argv
if (workspaceRoot === undefined) {
  console.error('usage: node bin/render.mjs <designmapDir> [viewId] [--write] [--index] [--log]')
  process.exit(2)
}
const write = rest.includes('--write')
const withIndex = rest.includes('--index')
const verbose = rest.includes('--log')
const viewArg = rest.find(argument => !argument.startsWith('--'))

const workspace = createWorkspace(workspaceRoot)
const started = performance.now()

try {
  const logger = createLogger()
  if (withIndex) {
    const result = await renderAll({ workspace, logger })
    console.log(JSON.stringify({
      indexPath: workspace.paths.index,
      indexHash: result.indexHash,
      views: result.rendered,
      totalMs: Math.round((performance.now() - started) * 100) / 100,
      events: verbose ? logger.events : undefined,
    }, null, 2))
  } else {
    const { views } = workspace.readViews()
    const viewId = viewArg ?? views.views[0]?.id
    if (viewId === undefined) {
      console.error('no views in views.yaml and no viewId given')
      process.exit(1)
    }
    const result = await renderView({
      model: workspace.readModel().model,
      views,
      overlays: workspace.readOverlays().overlays,
      viewId,
      logger,
    })
    let written = null
    if (write) written = workspace.writeScene(viewId, result.sceneJson)
    console.log(JSON.stringify({
      viewId: result.viewId,
      sceneHash: result.sceneHash,
      bytes: result.bytes,
      layout: result.layout,
      lint: result.lint,
      merge: { applied: result.merge.applied, colours: [...result.merge.colours.keys()], gc: result.merge.gc },
      written,
      totalMs: Math.round((performance.now() - started) * 100) / 100,
      events: verbose ? logger.events : undefined,
    }, null, 2))
  }
} catch (error) {
  if (error instanceof DesignmapRefusal) {
    console.error(JSON.stringify({ refusal: { code: error.code, message: error.message, details: error.details } }, null, 2))
    process.exit(1)
  }
  console.error(error)
  process.exit(2)
}
