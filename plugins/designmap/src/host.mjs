/**
 * The living-doc host service (M3).
 *
 * Everything the agent tools and the panel command do against a workspace lives here,
 * so the Cordis plugin file is only registration: status/scan/apply/render/lint/open/
 * export, the manifest writer, the JSONL event log and the SVG exporter.
 *
 * The cycle it implements (owner spec §9) is:
 *
 *   status  — does the manifest lag the code? which nodes are stale?
 *   scan    — which source changes map to model nodes, and what ops would close the gap?
 *             (read-only: scanning never writes)
 *   apply   — writes the semantic ops and the manifest; idempotent, all-or-nothing
 *   render  — scenes + out/index.json with stale flags from status
 *   lint    — findings without touching the disk
 *   export  — SVG of the current scene, overlays included
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { createWorkspace } from './workspace.mjs'
import { applyToWorkspace } from './apply.mjs'
import { renderView } from './render.mjs'
import { renderAll } from './index-file.mjs'
import { createLogger } from './log.mjs'
import { DesignmapRefusal, REFUSALS } from './schema.mjs'
import { buildManifest, hashFile, readManifest, resolveSource, sourceHashes, writeManifest } from './manifest.mjs'
import { createGit, GitError, isCommit } from './git.mjs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { sceneToSvg } from './svg.mjs'
import { sha256 } from './canonical.mjs'
import { inPalette } from './palette.mjs'
import { selectView } from './render.mjs'

export const LOG_FILE = 'events.jsonl'

const DEFAULT_SCAN_ROOTS = ['src']
const DEFAULT_SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.py', '.go', '.sql']
const TYPE_RULES = [
  [/(^|\/)(db|database|datastore|storage|schema)\//u, 'datastore'],
  [/(^|\/)(queue|kafka|bus|topic)\//u, 'queue'],
  [/(^|\/)(worker|workers|job|jobs|consumer)\//u, 'worker'],
  [/(^|\/)(ui|web|client|frontend|components?)\//u, 'frontend'],
  [/(^|\/)(external|vendor|third_party|stub)\//u, 'external'],
]

/** Append-only JSONL logger for one workspace: `designmap/logs/events.jsonl`. */
export function createFileLogger(designmapDir) {
  // A read-only tool call on a workspace that has no designmap directory yet must not
  // create one: without the directory there is nowhere to log, so the sink is a no-op.
  if (!existsSync(designmapDir)) return { logger: createLogger(), path: null }
  const dir = join(designmapDir, 'logs')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, LOG_FILE)
  const logger = createLogger(line => appendFileSync(path, line))
  return { logger, path }
}

/** A node id proposed for a source file that no node references yet. */
export function proposalFor(path) {
  const withoutExtension = path.replace(/\.[^./]+$/u, '')
  const id = withoutExtension.replace(/[^A-Za-z0-9_.-]+/gu, '.').replace(/\.+/gu, '.').replace(/^[.-]+/u, '')
  const stem = basename(withoutExtension)
  const label = stem.split(/[-_.]+/u).filter(Boolean)
    .map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ') || id
  const type = TYPE_RULES.find(([pattern]) => pattern.test(path))?.[1] ?? 'service'
  return { kind: 'node', action: 'upsert', value: { id, type, label, group: null, source: path } }
}

function extensionOf(path) {
  const match = /\.[^./]+$/u.exec(path)
  return match === null ? '' : match[0]
}

function nodeIdsBySource(model) {
  const map = new Map()
  for (const node of model.nodes) {
    if (node.source === null || node.source === undefined) continue
    const list = map.get(node.source) ?? []
    list.push(node.id)
    map.set(node.source, list)
  }
  return map
}

/** Candidate SVG→PNG converters, in order of preferred output quality. */
export const PNG_CONVERTERS = Object.freeze(['rsvg-convert', 'convert', 'magick'])

/** Resolve a command on PATH, or confirm an absolute/relative path exists. */
function resolveExecutable(command, pathEnv = process.env.PATH ?? '') {
  if (command.includes('/') || isAbsolute(command)) return existsSync(command) ? command : null
  for (const directory of pathEnv.split(':')) {
    if (directory === '') continue
    const candidate = join(directory, command)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Find a converter for the optional PNG export.
 * `DESIGNMAP_PNG_CONVERTER` wins when set (absolute path or command name); otherwise the
 * first of rsvg-convert / ImageMagick convert / magick found on PATH. PNG export is
 * OPTIONAL by design: without a converter the export refuses with `png_converter_missing`
 * instead of adding a rasteriser dependency to the plugin.
 * @returns `{command, configured}` or null.
 */
export function findPngConverter({ env = process.env } = {}) {
  const configured = env.DESIGNMAP_PNG_CONVERTER
  if (typeof configured === 'string' && configured !== '') {
    const resolved = resolveExecutable(configured, env.PATH)
    return resolved === null ? { missing: configured } : { command: resolved, configured: true }
  }
  for (const candidate of PNG_CONVERTERS) {
    const resolved = resolveExecutable(candidate, env.PATH)
    if (resolved !== null) return { command: resolved, configured: false }
  }
  return null
}

/**
 * Create the host service for one designmap directory.
 * @param root0.designmapDir - directory holding model.yaml/views.yaml/overlays.json/out.
 * @param root0.repoRoot - workspace root the `source` paths are relative to.
 * @param root0.git - injectable git runner (tests pass a fake or a real one).
 * @param root0.clock - injectable clock for manifest `generatedAt`.
 * @param root0.logger - M0 logger (createLogger) for domain events.
 */
export function createHostService({ designmapDir, repoRoot, git, clock = () => new Date(), logger } = {}) {
  const dir = resolve(designmapDir)
  const root = resolve(repoRoot ?? dirname(dir))
  const workspace = createWorkspace(dir)
  const gitRunner = git ?? createGit({ cwd: root })
  const now = () => clock().toISOString()
  const log = (event, fields) => logger?.log(event, fields)

  const head = () => {
    try {
      return gitRunner.head()
    } catch (error) {
      if (error instanceof GitError) return null
      throw error
    }
  }

  const status = () => {
    const model = workspace.readModel().model
    const warnings = []
    const read = readManifest(dir)
    const headCommit = head()
    const staleNodes = []
    let commit = null
    let commitBehind = null
    let missingManifest = false

    if (read.manifest === null) {
      missingManifest = true
      warnings.push(read.malformed === undefined ? 'manifest_missing' : `manifest_malformed: ${read.malformed}`)
      for (const node of model.nodes) {
        if (node.source === null || node.source === undefined) continue
        staleNodes.push({ id: node.id, source: node.source, reason: 'no_manifest' })
      }
    } else {
      commit = isCommit(read.manifest.commit ?? '') ? read.manifest.commit : null
      if (commit === null) warnings.push('manifest_commit_invalid')
      commitBehind = commit === null ? null : gitRunner.commitBehind(commit)
      if (commit !== null && commitBehind === null) warnings.push('manifest_commit_unknown')
      const expected = read.manifest.sourceHashes ?? {}
      for (const node of model.nodes) {
        if (node.source === null || node.source === undefined) continue
        const absolute = resolveSource(root, node.source)
        const current = absolute === null ? null : hashFile(absolute)
        if (!(node.id in expected)) {
          staleNodes.push({ id: node.id, source: node.source, reason: 'not_in_manifest' })
        } else if (expected[node.id] !== current) {
          staleNodes.push({ id: node.id, source: node.source, reason: current === null ? 'source_missing' : 'source_changed' })
        }
      }
    }

    const stale = missingManifest
      || commitBehind !== null && commitBehind > 0
      || staleNodes.length > 0
      || warnings.includes('manifest_commit_unknown')
      || warnings.includes('manifest_commit_invalid')
    return {
      ok: true,
      stale,
      missingManifest,
      commit,
      head: headCommit,
      commitBehind,
      staleNodeIds: staleNodes.map(entry => entry.id),
      staleNodes,
      warnings,
    }
  }

  const scan = ({ roots = DEFAULT_SCAN_ROOTS, extensions = DEFAULT_SCAN_EXTENSIONS } = {}) => {
    const model = workspace.readModel().model
    const read = readManifest(dir)
    const headCommit = head()
    const base = read.manifest?.commit ?? headCommit
    const warnings = []
    let changes = []
    try {
      changes = gitRunner.diffNameStatus(base)
    } catch (error) {
      if (!(error instanceof GitError)) throw error
      warnings.push('git_unavailable')
    }

    const bySource = nodeIdsBySource(model)
    const edgesByNode = new Map()
    for (const edge of model.edges) {
      for (const id of [edge.from, edge.to]) {
        const list = edgesByNode.get(id) ?? []
        if (!list.includes(edge.id)) list.push(edge.id)
        edgesByNode.set(id, list)
      }
    }

    const changedFiles = []
    const proposedOps = []
    const affected = new Set()
    const unrepresented = []
    const blocked = []

    for (const change of changes) {
      const statusCode = String(change.status ?? '')[0]
      const path = change.path
      const nodeIds = [...(bySource.get(path) ?? []), ...(change.from === null ? [] : bySource.get(change.from) ?? [])]
      changedFiles.push({ path, status: statusCode, nodeIds: [...new Set(nodeIds)] })
      if (statusCode === 'D') {
        for (const nodeId of bySource.get(path) ?? []) {
          const edges = edgesByNode.get(nodeId) ?? []
          if (edges.length > 0) blocked.push({ nodeId, reason: 'node_has_edges', edges })
          else proposedOps.push({ kind: 'node', action: 'remove', id: nodeId })
        }
        continue
      }
      if (statusCode === 'A' || statusCode === 'R' || statusCode === 'C') {
        const referenced = bySource.has(path)
        const watched = roots.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
        if (!referenced && watched && extensions.includes(extensionOf(path))) proposedOps.push(proposalFor(path))
        else if (!referenced) unrepresented.push({ path, status: statusCode })
        else for (const nodeId of bySource.get(path) ?? []) affected.add(nodeId)
        continue
      }
      // Modified / type-changed: the model is still semantically valid; the human or
      // agent decides whether the node's meaning changed.
      for (const nodeId of bySource.get(path) ?? []) affected.add(nodeId)
    }

    return {
      ok: true,
      head: headCommit,
      manifestCommit: read.manifest?.commit ?? null,
      base,
      changedFiles,
      proposedOps,
      affectedNodes: [...affected].sort(),
      unrepresented,
      blocked,
      warnings,
    }
  }

  const apply = (ops, { logger: inner } = {}) => {
    const resolved = Array.isArray(ops) ? ops : ops?.ops
    if (!Array.isArray(resolved)) {
      throw new DesignmapRefusal(REFUSALS.invalidOps, 'apply needs an array of ops', { ops })
    }
    const result = applyToWorkspace(workspace, resolved, { logger: inner ?? logger })
    const model = workspace.readModel().model
    const headCommit = head()
    const manifest = buildManifest({ model, repoRoot: root, commit: headCommit, generatedAt: now() })
    const written = writeManifest(dir, manifest)
    return {
      ok: true,
      applied: result.applied,
      skipped: result.skipped,
      ops: result.ops,
      diff: result.diff,
      written: { model: result.written.model, views: result.written.views, manifest: written.written },
      manifest: { commit: manifest.commit, generatedAt: manifest.generatedAt, nodes: Object.keys(manifest.sourceHashes).length },
    }
  }

  const envelopeFor = (result, staleReport) => ({
    ok: true,
    viewId: result.viewId,
    scenePath: relative(root, workspace.scenePath(result.viewId)) || workspace.scenePath(result.viewId),
    sceneHash: result.sceneHash,
    bytes: result.bytes,
    scene: result.scene,
    stale: {
      stale: staleReport.stale,
      missingManifest: staleReport.missingManifest,
      commit: staleReport.commit,
      head: staleReport.head,
      commitBehind: staleReport.commitBehind,
      staleNodes: staleReport.staleNodes,
      warnings: staleReport.warnings,
    },
    lint: result.lint,
    generatedAt: now(),
    commit: staleReport.head,
  })

  const render = async ({ viewId, logger: inner, write = true } = {}) => {
    const staleReport = status()
    const viewsDoc = workspace.readViews().views
    if (viewId !== undefined) {
      const view = viewsDoc.views.find(candidate => candidate.id === viewId)
      if (view === undefined) {
        throw new DesignmapRefusal(REFUSALS.unknownView, `unknown view "${viewId}"`, {
          viewId,
          available: viewsDoc.views.map(candidate => candidate.id),
        })
      }
    }
    if (!write) {
      if (viewId !== undefined) {
        const result = await renderView({
          model: workspace.readModel().model,
          views: viewsDoc,
          overlays: workspace.readOverlays().overlays,
          viewId,
          staleNodeIds: staleReport.staleNodeIds,
          logger: inner ?? logger,
        })
        return envelopeFor(result, staleReport)
      }
      const views = []
      for (const view of viewsDoc.views) {
        const result = await renderView({
          model: workspace.readModel().model,
          views: viewsDoc,
          overlays: workspace.readOverlays().overlays,
          viewId: view.id,
          staleNodeIds: staleReport.staleNodeIds,
          logger: inner ?? logger,
        })
        views.push(envelopeFor(result, staleReport))
      }
      return { ok: true, views, stale: { stale: staleReport.stale, staleNodes: staleReport.staleNodes, commitBehind: staleReport.commitBehind, missingManifest: staleReport.missingManifest, warnings: staleReport.warnings }, generatedAt: now(), commit: staleReport.head }
    }

    const bundle = await renderAll({ workspace, logger: inner ?? logger, staleNodeIds: staleReport.staleNodeIds })
    const envelopes = []
    for (const row of bundle.rendered) envelopes.push(envelopeFor(row, staleReport))
    const index = {
      ok: true,
      indexPath: relative(root, workspace.paths.index) || workspace.paths.index,
      indexHash: bundle.indexHash,
      views: envelopes,
      stale: { stale: staleReport.stale, staleNodes: staleReport.staleNodes, commitBehind: staleReport.commitBehind, missingManifest: staleReport.missingManifest, warnings: staleReport.warnings },
      generatedAt: now(),
      commit: staleReport.head,
    }
    return viewId === undefined ? index : envelopes.find(envelope => envelope.viewId === viewId)
  }

  const lint = async ({ viewId } = {}) => {
    const staleReport = status()
    const model = workspace.readModel().model
    const viewsDoc = workspace.readViews().views
    const overlays = workspace.readOverlays().overlays
    const ids = viewId === undefined ? viewsDoc.views.map(view => view.id) : [viewId]
    const results = []
    for (const id of ids) {
      try {
        const result = await renderView({ model, views: viewsDoc, overlays, viewId: id, staleNodeIds: staleReport.staleNodeIds, logger })
        results.push({ viewId: id, ok: true, lint: result.lint })
      } catch (error) {
        if (!(error instanceof DesignmapRefusal)) throw error
        const findings = error.details?.findings ?? []
        results.push({ viewId: id, ok: true, lint: { ok: false, findings, counts: countSeverities(findings), rules: [...new Set(findings.map(entry => entry.rule))].sort(), refusal: error.code } })
      }
    }
    return { ok: true, views: results, stale: { stale: staleReport.stale, staleNodes: staleReport.staleNodes } }
  }

  const open = ({ nodeId } = {}) => {
    const model = workspace.readModel().model
    const node = model.nodes.find(candidate => candidate.id === nodeId)
    if (node === undefined) {
      throw new DesignmapRefusal('unknown_node', `unknown node "${nodeId}"`, { nodeId, nodes: model.nodes.map(candidate => candidate.id) })
    }
    if (node.source === null || node.source === undefined) {
      return { ok: false, code: 'missing_source', nodeId, message: `node "${nodeId}" has no source` }
    }
    const absolute = resolveSource(root, node.source)
    const exists = absolute !== null && hashFile(absolute) !== null
    if (!exists) return { ok: false, code: 'source_missing', nodeId, source: node.source, message: `source "${node.source}" does not exist` }
    return { ok: true, nodeId, source: node.source, absolute, line: null }
  }

  /**
   * Human overlay write path (M2's panel, carried by the /designmap command):
   * upsert one node's visual keys, reset one node, or reset every node on a view.
   * Agent tools never expose this — it is the human's edit path.
   */
  const overlay = (payload = {}) => {
    const model = workspace.readModel().model
    const viewsDoc = workspace.readViews().views
    const read = workspace.readOverlays()
    const current = read.overlays !== null && typeof read.overlays === 'object' && !Array.isArray(read.overlays)
      ? structuredClone(read.overlays)
      : {}
    const action = payload.action ?? 'upsert'
    const nodeIds = new Set(model.nodes.map(node => node.id))
    // The overlay file is the human's visual layer only. A panel that tries to smuggle
    // a model field through the overlay command gets a named refusal, never a silent
    // drop and never a write.
    const payloadKeys = ['action', 'nodeId', 'viewId', 'row', 'x', 'y', 'fill', 'stroke']
    const unknown = Object.keys(payload).filter(key => !payloadKeys.includes(key))
    if (unknown.length > 0) {
      throw new DesignmapRefusal('model_fields_forbidden', `overlay cannot write model fields (${unknown.join(', ')})`, { fields: unknown })
    }
    const validateRow = (row, nodeId) => {
      const kept = {}
      for (const key of Object.keys(row)) {
        if (!['x', 'y', 'fill', 'stroke'].includes(key)) {
          throw new DesignmapRefusal('model_fields_forbidden', `overlay row cannot write "${key}" on "${nodeId}"`, { nodeId, field: key })
        }
      }
      for (const axis of ['x', 'y']) {
        const value = row[axis]
        if (value === undefined) continue
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new DesignmapRefusal('invalid_coordinate', `overlay ${axis} must be a finite number`, { axis, value })
        }
        if (value < 0) throw new DesignmapRefusal('negative_coordinate', `overlay ${axis} must not be negative`, { axis, value })
        kept[axis] = Math.round(value * 100) / 100
      }
      for (const colour of ['fill', 'stroke']) {
        const value = row[colour]
        if (value === undefined) continue
        if (!inPalette(value)) {
          throw new DesignmapRefusal('colour_out_of_palette', `overlay ${colour} "${String(value)}" is outside the palette`, { colour, value })
        }
        kept[colour] = value
      }
      return kept
    }

    if (action === 'upsert') {
      const nodeId = payload.nodeId
      if (typeof nodeId !== 'string' || !nodeIds.has(nodeId)) {
        throw new DesignmapRefusal('unknown_node', `unknown node "${String(nodeId)}"`, { nodeId, nodes: [...nodeIds] })
      }
      const kept = validateRow({ x: payload.x, y: payload.y, fill: payload.fill, stroke: payload.stroke }, nodeId)
      if (Object.keys(kept).length === 0) {
        throw new DesignmapRefusal('invalid_overlay', 'overlay upsert needs at least one of x/y/fill/stroke', { nodeId })
      }
      current[nodeId] = { ...(current[nodeId] ?? {}), ...kept }
      const written = workspace.writeOverlays(current)
      logger?.log('overlay.write', { action, nodeId, keys: Object.keys(kept).sort(), rows: Object.keys(current).length })
      return { ok: true, action, nodeId, keys: Object.keys(kept).sort(), rows: Object.keys(current).length, overlaysPath: relative(root, written.path) || written.path }
    }

    if (action === 'replace') {
      const nodeId = payload.nodeId
      if (typeof nodeId !== 'string' || !nodeIds.has(nodeId)) {
        throw new DesignmapRefusal('unknown_node', `unknown node "${String(nodeId)}"`, { nodeId })
      }
      const row = payload.row ?? null
      if (row !== null) {
        if (typeof row !== 'object' || Array.isArray(row)) {
          throw new DesignmapRefusal('invalid_overlay', 'overlay replace row must be an object or null', { nodeId })
        }
        const kept = validateRow(row, nodeId)
        if (Object.keys(kept).length === 0) delete current[nodeId]
        else current[nodeId] = kept
      } else {
        delete current[nodeId]
      }
      const written = workspace.writeOverlays(current)
      logger?.log('overlay.write', { action, nodeId, keys: Object.keys(current[nodeId] ?? {}).sort(), rows: Object.keys(current).length })
      return { ok: true, action, nodeId, keys: Object.keys(current[nodeId] ?? {}).sort(), rows: Object.keys(current).length, overlaysPath: relative(root, written.path) || written.path }
    }

    if (action === 'resetNode') {
      const nodeId = payload.nodeId
      if (typeof nodeId !== 'string' || !nodeIds.has(nodeId)) {
        throw new DesignmapRefusal('unknown_node', `unknown node "${String(nodeId)}"`, { nodeId })
      }
      delete current[nodeId]
      const written = workspace.writeOverlays(current)
      logger?.log('overlay.write', { action, nodeId, rows: Object.keys(current).length })
      return { ok: true, action, nodeId, rows: Object.keys(current).length, overlaysPath: relative(root, written.path) || written.path }
    }

    if (action === 'resetView') {
      const view = viewsDoc.views.find(candidate => candidate.id === payload.viewId)
      if (view === undefined) {
        throw new DesignmapRefusal(REFUSALS.unknownView, `unknown view "${payload.viewId}"`, { viewId: payload.viewId })
      }
      const selected = selectView(model, view)
      let removed = 0
      for (const node of selected.nodes) {
        if (node.id in current) {
          delete current[node.id]
          removed += 1
        }
      }
      const written = workspace.writeOverlays(current)
      logger?.log('overlay.write', { action, viewId: view.id, removed, rows: Object.keys(current).length })
      return { ok: true, action, viewId: view.id, removed, rows: Object.keys(current).length, overlaysPath: relative(root, written.path) || written.path }
    }

    throw new DesignmapRefusal('invalid_overlay', `unknown overlay action "${String(action)}" (upsert | replace | resetNode | resetView)`, { action })
  }

  const exportSvg = async ({ viewId } = {}) => {
    const staleReport = status()
    const viewsDoc = workspace.readViews().views
    const id = viewId ?? viewsDoc.views[0]?.id
    if (id === undefined) {
      throw new DesignmapRefusal(REFUSALS.unknownView, 'no views to export', { viewId })
    }
    const result = await renderView({
      model: workspace.readModel().model,
      views: viewsDoc,
      overlays: workspace.readOverlays().overlays,
      viewId: id,
      staleNodeIds: staleReport.staleNodeIds,
      logger,
    })
    const svg = sceneToSvg(result.scene, { colours: result.merge.colours })
    const path = join(workspace.paths.out, `${id}.svg`)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, svg, 'utf8')
    return {
      ok: true,
      viewId: id,
      svgPath: relative(root, path) || path,
      bytes: Buffer.byteLength(svg),
      hash: sha256(svg),
      sceneHash: result.sceneHash,
      nodes: result.scene.nodes.length,
      edges: result.scene.edges.length,
      labels: result.scene.nodes.map(node => node.label),
      colours: [...result.merge.colours.keys()],
      written: true,
    }
  }

  /**
   * Export one view. SVG is the canonical artifact and is always written; `format:'png'`
   * additionally rasterises it with an external converter (optional; no dependency).
   */
  const exportView = async ({ viewId, format = 'svg' } = {}) => {
    const svgResult = await exportSvg({ viewId })
    if (format === 'svg') return { ...svgResult, format: 'svg' }
    if (format !== 'png') {
      throw new DesignmapRefusal('invalid_export_format', `unknown export format "${String(format)}" (svg | png)`, { format })
    }
    const converter = findPngConverter()
    if (converter === null || converter.missing !== undefined) {
      throw new DesignmapRefusal('png_converter_missing', 'PNG export needs rsvg-convert, ImageMagick convert or magick on PATH (or DESIGNMAP_PNG_CONVERTER)', {
        svgPath: svgResult.svgPath,
        configured: converter?.missing ?? null,
        candidates: PNG_CONVERTERS,
      })
    }
    const svgAbsolute = join(root, svgResult.svgPath)
    const pngAbsolute = join(workspace.paths.out, `${svgResult.viewId}.png`)
    const args = converter.command.endsWith('rsvg-convert')
      ? ['-o', pngAbsolute, svgAbsolute]
      : [svgAbsolute, pngAbsolute]
    const run = spawnSync(converter.command, args, { encoding: 'utf8' })
    if (run.error !== undefined || run.status !== 0) {
      throw new DesignmapRefusal('png_export_failed', `PNG conversion failed (${converter.command})`, {
        svgPath: svgResult.svgPath,
        status: run.status,
        stderr: String(run.stderr ?? run.error?.message ?? '').slice(0, 2000),
      })
    }
    const bytes = readFileSync(pngAbsolute)
    return {
      ...svgResult,
      format: 'png',
      svgPath: svgResult.svgPath,
      pngPath: relative(root, pngAbsolute) || pngAbsolute,
      pngBytes: statSync(pngAbsolute).size,
      pngHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      converter: converter.command,
    }
  }

  return {
    paths: { designmapDir: dir, repoRoot: root, logs: join(dir, 'logs'), manifest: join(dir, 'manifest.json') },
    workspace,
    status,
    scan,
    apply,
    overlay,
    render,
    lint,
    open,
    exportSvg,
    exportView,
    readManifest: () => readManifest(dir),
    sourceHashes: () => sourceHashes(workspace.readModel().model, root),
  }
}

function countSeverities(findings) {
  const counts = { error: 0, warning: 0, info: 0 }
  for (const entry of findings) counts[entry.severity] += 1
  return counts
}
