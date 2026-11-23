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
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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
import { inPalette, isHexColour } from './palette.mjs'
import { selectView } from './render.mjs'
import { boxesWithinGap, findFreeSpot } from './overlays.mjs'

export const LOG_FILE = 'events.jsonl'

/** A repo-relative path in the form the kit reports everywhere: forward slashes on every platform. */
function repoRelative(root, absolute) {
  return (relative(root, absolute) || absolute).split(sep).join('/')
}

/** Annotation layer limits and the element types the Excalidraw canvas can produce. */
const MAX_ANNOTATIONS = 200

/** Element types a human annotation may use (the drawing tools the canvas offers). */
const ANNOTATION_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'text', 'freedraw'])

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
    // The revision continues from the manifest already on disk; the content hash decides
    // whether it moves (see src/manifest.mjs). Read it BEFORE writing: writeManifest compares
    // against the same file, so the order is the previous state and then the next one.
    const previous = readManifest(dir).manifest
    const manifest = buildManifest({ model, repoRoot: root, commit: headCommit, generatedAt: now(), previous, changed: result.written.model })
    const written = writeManifest(dir, manifest)
    return {
      ok: true,
      applied: result.applied,
      skipped: result.skipped,
      ops: result.ops,
      diff: result.diff,
      written: { model: result.written.model, views: result.written.views, manifest: written.written },
      manifest: { rev: manifest.rev, commit: manifest.commit, generatedAt: manifest.generatedAt, nodes: Object.keys(manifest.sourceHashes).length },
    }
  }

  const envelopeFor = (result, staleReport) => ({
    ok: true,
    viewId: result.viewId,
    scenePath: repoRelative(root, workspace.scenePath(result.viewId)),
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

  /**
   * The panel's read path: every view RENDERED WITH the stored overlays, in the shape the
   * client's `load` already consumes (`{views:[{view,scene,meta}], rootId, overlays, annotations}`).
   *
   * This exists because reading `out/*.scene.json` and merging overlays in the browser made
   * two geometry owners: the node moved, the arrows and label plates did not. The render
   * pipeline already re-anchors edge endpoints and re-places plates for overlaid nodes, so
   * the panel must draw that scene, not its own merge. Nothing is written: `write:false`
   * keeps `out/` as the artifact the agent's `render` owns.
   */
  const panelViews = async ({ viewId } = {}) => {
    const staleReport = status()
    const viewsDoc = workspace.readViews().views
    if (viewId !== undefined && !viewsDoc.views.some(view => view.id === viewId)) {
      throw new DesignmapRefusal(REFUSALS.unknownView, `unknown view "${String(viewId)}"`, { viewId })
    }
    const model = workspace.readModel().model
    const overlays = workspace.readOverlays().overlays
    const ids = viewId === undefined ? viewsDoc.views.map(view => view.id) : [viewId]
    const rows = []
    for (const id of ids) {
      const view = viewsDoc.views.find(candidate => candidate.id === id)
      const result = await renderView({
        model,
        views: viewsDoc,
        overlays,
        viewId: id,
        staleNodeIds: staleReport.staleNodeIds,
        logger,
      })
      rows.push({
        view: { viewId: id, title: view.title ?? '', level: view.level, parentGroupId: view.parent ?? null },
        scene: result.scene,
        meta: {
          generatedAt: now(),
          commit: staleReport.head,
          sceneHash: result.sceneHash,
          scenePath: repoRelative(root, workspace.scenePath(id)),
          stale: {
            stale: staleReport.stale,
            commitBehind: staleReport.commitBehind,
            staleNodes: staleReport.staleNodeIds,
          },
          lint: result.lint,
        },
      })
    }
    const index = workspace.readIndex().index
    const indexRows = Array.isArray(index?.views) ? index.views : []
    const rootRow = indexRows.find(row => row.parent === null && row.level === 'context') ?? indexRows.find(row => row.parent === null) ?? null
    const rootId =
      rows.find(row => row.view.viewId === rootRow?.viewId)?.view.viewId ??
      rows.find(row => row.view.level === 'context')?.view.viewId ??
      rows[0]?.view.viewId ??
      null
    const annotations = workspace.readAnnotations().elements
    logger?.log('panel.views', { views: rows.length, viewId: viewId ?? null })
    return {
      ok: true,
      views: rows,
      rootId,
      overlays: { rows: overlays, path: 'designmap/overlays.json' },
      annotations,
      stale: {
        stale: staleReport.stale,
        commitBehind: staleReport.commitBehind,
        staleNodes: staleReport.staleNodes,
      },
      generatedAt: now(),
      commit: staleReport.head,
    }
  }

  /** Distance an auto-placed node keeps from its neighbours (see findFreeSpot). */
  const OVERLAY_GAP = 8

  /**
   * The overlay row is global, but a node's box comes from one view's layout. The panel
   * sends the view it is looking at; a script can omit it and get the first view that
   * draws the node.
   */
  const viewForNode = (model, viewsDoc, nodeId, viewId) => {
    if (viewId !== undefined) return viewsDoc.views.find(view => view.id === viewId) ?? null
    return viewsDoc.views.find(view => selectView(model, view).nodes.some(node => node.id === nodeId)) ?? null
  }

  /**
   * Auto-placement for a human move: when the requested top-left would put the node on
   * (or too close to) another node, the nearest free cell wins. Returns
   * `{x, y, moved, from}` or `null` when the node is not drawn by any view or no free
   * cell was found — in both cases the caller writes the requested row and the scene
   * lint reports the overlap as a warning instead of silently losing the drop.
   */
  const autoPlace = async ({ nodeId, x, y, viewId, overlays }) => {
    const model = workspace.readModel().model
    const viewsDoc = workspace.readViews().views
    const view = viewForNode(model, viewsDoc, nodeId, viewId)
    if (view === null) return null
    const result = await renderView({
      model,
      views: viewsDoc,
      overlays,
      viewId: view.id,
      staleNodeIds: [],
      logger,
    })
    const self = result.scene.nodes.find(node => node.id === nodeId)
    if (self === undefined) return null
    // The effective box of a one-axis move is the requested axis plus the scene's other
    // axis: a drag that only changed x can still land on a neighbour, and the rule must
    // see the box the human actually sees.
    const requested = { x: x ?? self.x, y: y ?? self.y, w: self.w, h: self.h }
    const obstacles = result.scene.nodes
      .filter(node => node.id !== nodeId)
      .map(node => ({ x: node.x, y: node.y, w: node.w, h: node.h }))
    const collides = obstacles.some(obstacle => boxesWithinGap(requested, obstacle, OVERLAY_GAP))
    if (!collides) return { x: requested.x, y: requested.y, moved: false, from: requested }
    const placed = findFreeSpot({ box: requested, obstacles, gap: OVERLAY_GAP })
    if (placed === null) return { x: requested.x, y: requested.y, moved: false, from: requested, unresolved: true }
    return { ...placed, moved: placed.x !== requested.x || placed.y !== requested.y, from: requested }
  }

  /**
   * The human's label edit path: a label is a MODEL field, so it goes through `apply`
   * (whole-document validation, manifest rebuild) and never through the overlay file.
   * An empty edge label is refused here with the lint rule's own code, because it would
   * make every render refuse after the write; the model stays byte-identical.
   */
  const label = ({ kind = 'node', id, label: next } = {}) => {
    if (kind !== 'node' && kind !== 'edge') {
      throw new DesignmapRefusal('invalid_label_target', `label target must be node or edge, got "${String(kind)}"`, { kind })
    }
    if (typeof id !== 'string' || id === '') {
      throw new DesignmapRefusal('invalid_label_target', 'label needs a node or edge id', { kind, id })
    }
    if (typeof next !== 'string') {
      throw new DesignmapRefusal('invalid_label', 'label must be a string', { kind, id, type: typeof next })
    }
    const text = next.trim()
    if (text === '') {
      const code = kind === 'edge' ? REFUSALS.missingEdgeLabel : 'invalid_label'
      throw new DesignmapRefusal(code, `${kind} "${id}" cannot have an empty label`, { kind, id })
    }
    if (text.length > 200) {
      throw new DesignmapRefusal('invalid_label', `label for "${id}" is longer than 200 characters`, { kind, id, length: text.length })
    }
    const model = workspace.readModel().model
    let row
    if (kind === 'node') {
      const node = model.nodes.find(candidate => candidate.id === id)
      if (node === undefined) throw new DesignmapRefusal('unknown_node', `unknown node "${id}"`, { id })
      row = { ...node, label: text }
    } else {
      const edge = model.edges.find(candidate => candidate.id === id)
      if (edge === undefined) throw new DesignmapRefusal('unknown_edge', `unknown edge "${id}"`, { id })
      row = { ...edge, label: text }
    }
    const result = apply([{ kind, action: 'upsert', value: row }])
    logger?.log('label.write', { kind, id, length: text.length })
    return { ok: true, kind, id, label: text, applied: result.applied, written: result.written, manifest: result.manifest, diff: result.diff }
  }

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
      indexPath: repoRelative(root, workspace.paths.index),
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
   * The human's annotation layer (free drawings, notes, highlights), written whole by
   * the panel. It is NOT the model and NOT the scene: elements are validated into a
   * closed shape, a forged `customData.designmap` is refused (it would let a drawing
   * masquerade as scene geometry), and nothing here is ever read by render.
   */
  const annotate = (payload = {}) => {
    const elements = payload.elements
    if (!Array.isArray(elements)) {
      throw new DesignmapRefusal('invalid_annotation', 'annotate needs an elements array', { type: typeof elements })
    }
    if (elements.length > MAX_ANNOTATIONS) {
      throw new DesignmapRefusal('annotation_limit', `annotate accepts at most ${MAX_ANNOTATIONS} elements`, { count: elements.length, max: MAX_ANNOTATIONS })
    }
    const cleaned = elements.map((element, index) => {
      if (element === null || typeof element !== 'object' || Array.isArray(element)) {
        throw new DesignmapRefusal('invalid_annotation', `annotation ${index} is not an object`, { index })
      }
      if (!ANNOTATION_TYPES.has(element.type)) {
        throw new DesignmapRefusal('invalid_annotation', `annotation ${index} has unsupported type "${String(element.type)}"`, { index, type: element.type })
      }
      for (const axis of ['x', 'y', 'width', 'height']) {
        if (!Number.isFinite(element[axis])) {
          throw new DesignmapRefusal('invalid_annotation', `annotation ${index} ${axis} must be a finite number`, { index, field: axis })
        }
      }
      if (element.customData?.designmap !== undefined) {
        throw new DesignmapRefusal('annotation_forbidden_fields', `annotation ${index} carries designmap customData`, { index })
      }
      if (Array.isArray(element.points) && (element.points.length > 4096 || element.points.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)))) {
        throw new DesignmapRefusal('invalid_annotation', `annotation ${index} has invalid points`, { index })
      }
      const copy = structuredClone(element)
      delete copy.customData
      delete copy.link
      delete copy.isDeleted
      delete copy.locked
      // A human element must never bind itself into a scene element (a note glued inside
      // a node chip would move with the model the human does not own).
      if (typeof copy.containerId === 'string' && copy.containerId.startsWith('dm:')) delete copy.containerId
      return copy
    })
    const written = workspace.writeAnnotations(cleaned)
    logger?.log('annotate.write', { elements: cleaned.length, bytes: Buffer.byteLength(written.text) })
    return { ok: true, elements: cleaned.length, bytes: Buffer.byteLength(written.text), annotationsPath: repoRelative(root, written.path), hash: written.hash }
  }

  /**
   * Human overlay write path (M2's panel, carried by the /designmap command):
   * upsert one node's visual keys, reset one node, or reset every node on a view.
   * Agent tools never expose this — it is the human's edit path.
   */
  const overlay = async (payload = {}) => {
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
        if (!isHexColour(value)) {
          throw new DesignmapRefusal('invalid_colour', `overlay ${colour} "${String(value)}" is not a hex colour`, { colour, value })
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
      // A move becomes a collision-free move before it is stored: the nearest free cell
      // is found against the scene the core would draw (current overlays), so the panel,
      // the agent's render and a script all see the same rule. A colour-only upsert has
      // no position and skips this.
      let placement = null
      if (kept.x !== undefined || kept.y !== undefined) {
        placement = await autoPlace({ nodeId, x: kept.x, y: kept.y, viewId: payload.viewId, overlays: current })
        if (placement !== null && placement.moved) {
          // A corrected position is stored in full: the row now owns both axes, which is
          // exactly what a completed drag means for the person who made it.
          kept.x = placement.x
          kept.y = placement.y
        }
      }
      const before = current[nodeId] ?? null
      current[nodeId] = { ...(current[nodeId] ?? {}), ...kept }
      const written = workspace.writeOverlays(current)
      logger?.log('overlay.write', { action, nodeId, keys: Object.keys(kept).sort(), rows: Object.keys(current).length, autoPlaced: placement?.moved === true })
      return {
        ok: true,
        action,
        nodeId,
        keys: Object.keys(kept).sort(),
        row: current[nodeId],
        before,
        adjusted: placement?.moved === true ? { x: kept.x, y: kept.y, from: placement.from } : null,
        finding: placement?.unresolved === true
          ? { code: 'overlap_unresolved', severity: 'warning', nodeId, message: `no free position found for "${nodeId}"; the overlap stays and the scene lint reports it` }
          : placement?.moved === true
            ? { code: 'overlap_adjusted', severity: 'info', nodeId, from: placement.from, to: { x: kept.x, y: kept.y }, message: `"${nodeId}" was placed ${Math.round(placement.x - placement.from.x)},${Math.round(placement.y - placement.from.y)} px aside to keep it clear of the other nodes` }
            : null,
        rows: Object.keys(current).length,
        overlaysPath: repoRelative(root, written.path),
      }
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
      return { ok: true, action, nodeId, keys: Object.keys(current[nodeId] ?? {}).sort(), rows: Object.keys(current).length, overlaysPath: repoRelative(root, written.path) }
    }

    if (action === 'resetNode') {
      const nodeId = payload.nodeId
      if (typeof nodeId !== 'string' || !nodeIds.has(nodeId)) {
        throw new DesignmapRefusal('unknown_node', `unknown node "${String(nodeId)}"`, { nodeId })
      }
      delete current[nodeId]
      const written = workspace.writeOverlays(current)
      logger?.log('overlay.write', { action, nodeId, rows: Object.keys(current).length })
      return { ok: true, action, nodeId, rows: Object.keys(current).length, overlaysPath: repoRelative(root, written.path) }
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
      return { ok: true, action, viewId: view.id, removed, rows: Object.keys(current).length, overlaysPath: repoRelative(root, written.path) }
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
      svgPath: repoRelative(root, path),
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
      pngPath: repoRelative(root, pngAbsolute),
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
    label,
    views: panelViews,
    annotate,
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
