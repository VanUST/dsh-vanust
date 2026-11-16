#!/usr/bin/env node
/**
 * Acceptance run for designmap-core M0.
 *
 * This is the product being driven, not a test runner: it renders the real fixtures
 * through the same `renderView`/`applyToWorkspace` path the host will call, and prints
 * one JSON object with the evidence each acceptance line asks for. Exit code 1 when any
 * expected outcome is missing.
 *
 * Usage: node bin/acceptance.mjs
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorkspace } from '../src/workspace.mjs'
import { renderView } from '../src/render.mjs'
import { applyToWorkspace } from '../src/apply.mjs'
import { renderAll } from '../src/index-file.mjs'
import { parseModel, parseOps, parseViews } from '../src/schema.mjs'
import { createLogger } from '../src/log.mjs'
import { lintScene, summariseLint } from '../src/lint.mjs'
import { sha256 } from '../src/canonical.mjs'
import { lintCases, nonFiniteScene, badOverlays, sceneLintCases } from '../fixtures/lint-cases.mjs'
import { perfFixture } from '../fixtures/perf.mjs'
import { auditScene } from './audit-scene.mjs'

const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
const report = { checks: {}, ok: true }
const record = (name, value) => { report.checks[name] = value }
const require = (condition, message) => { if (!condition) { report.ok = false; report.failure ??= message } }

function demoInputs() {
  const workspace = createWorkspace(fixture('demo'))
  return {
    model: workspace.readModel().model,
    views: workspace.readViews().views,
    overlays: workspace.readOverlays().overlays,
  }
}

// 1. Two runs over the same fixture produce byte-identical scene JSON.
{
  const first = await renderView({ ...demoInputs(), viewId: 'v.context' })
  const second = await renderView({ ...demoInputs(), viewId: 'v.context' })
  const dir = mkdtempSync(join(tmpdir(), 'designmap-scene-'))
  const firstPath = join(dir, 'a.scene.json')
  const secondPath = join(dir, 'b.scene.json')
  writeFileSync(firstPath, first.sceneJson)
  writeFileSync(secondPath, second.sceneJson)
  const fileHash = path => sha256(readFileSync(path, 'utf8'))
  record('determinism', {
    equal: first.sceneJson === second.sceneJson,
    sceneHashFirst: first.sceneHash,
    sceneHashSecond: second.sceneHash,
    fileHashFirst: fileHash(firstPath),
    fileHashSecond: fileHash(secondPath),
    bytes: first.bytes,
    nodes: first.scene.nodes.length,
    edges: first.scene.edges.length,
    groups: first.scene.groups.length,
  })
  require(first.sceneJson === second.sceneJson, 'two renders differ')
  rmSync(dir, { recursive: true, force: true })
}

// 2. Geometry on a model or an op is refused by the schema with the exact path.
{
  let modelRefusal
  try {
    parseModel({
      schemaVersion: 1,
      groups: [],
      nodes: [
        { id: 'svc.a', type: 'service', label: 'A', group: null, source: null },
        { id: 'svc.b', type: 'service', label: 'B', group: null, source: null, x: 10, y: 20, fill: '#fff' },
      ],
      edges: [],
    })
  } catch (error) { modelRefusal = error }
  let opRefusal
  try {
    parseOps({ ops: [{ kind: 'node', action: 'upsert', value: { id: 'svc.a', type: 'service', label: 'A', x: 10, y: 20, fill: '#fff' } }] })
  } catch (error) { opRefusal = error }
  record('schemaRefusals', {
    model: { code: modelRefusal?.code, paths: modelRefusal?.details.issues.map(issue => issue.path) },
    op: { code: opRefusal?.code, paths: opRefusal?.details.issues.map(issue => issue.path) },
  })
  require(JSON.stringify(modelRefusal?.details.issues.map(issue => issue.path)) === JSON.stringify([['nodes', 1, 'x'], ['nodes', 1, 'y'], ['nodes', 1, 'fill']]), 'model geometry path mismatch')
  require(JSON.stringify(opRefusal?.details.issues.map(issue => issue.path)) === JSON.stringify([['ops', 0, 'value', 'x'], ['ops', 0, 'value', 'y'], ['ops', 0, 'value', 'fill']]), 'op geometry path mismatch')
}

// 3. An invalid reference is refused as a whole by apply and leaves the files unchanged.
{
  const dir = mkdtempSync(join(tmpdir(), 'designmap-apply-'))
  const source = createWorkspace(fixture('demo'))
  const workspace = createWorkspace(dir)
  workspace.writeModel(source.readModel().model)
  workspace.writeViews(source.readViews().views)
  const before = { model: workspace.hashOf('model'), views: workspace.hashOf('views') }
  const beforeBytes = readFileSync(join(dir, 'model.yaml'), 'utf8')
  let refusal
  try {
    applyToWorkspace(workspace, [
      { kind: 'node', action: 'upsert', value: { id: 'svc.new', type: 'service', label: 'New', group: null, source: null } },
      { kind: 'edge', action: 'upsert', value: { id: 'e.ghost', from: 'svc.new', to: 'ghost.node', kind: 'sync', label: 'x' } },
    ])
  } catch (error) { refusal = error }
  const after = { model: workspace.hashOf('model'), views: workspace.hashOf('views') }
  const unchanged = JSON.stringify(before) === JSON.stringify(after) && readFileSync(join(dir, 'model.yaml'), 'utf8') === beforeBytes
  record('invalidReference', { code: refusal?.code, missing: refusal?.details.references?.[0]?.missing, hashesBefore: before, hashesAfter: after, unchanged })
  require(refusal?.code === 'dangling_reference' && unchanged, 'apply did not refuse atomically')
  rmSync(dir, { recursive: true, force: true })
}

// 4. A missing model is a valid empty scene.
{
  const workspace = createWorkspace(fixture('empty'))
  const result = await renderView({
    model: workspace.readModel().model,
    views: workspace.readViews().views,
    overlays: {},
    viewId: 'v.empty',
  })
  record('emptyModel', {
    missing: workspace.readModel().missing,
    nodes: result.scene.nodes,
    edges: result.scene.edges,
    groups: result.scene.groups,
    canvas: result.scene.canvas,
    sceneHash: result.sceneHash,
    lintOk: result.lint.ok,
  })
  require(Array.isArray(result.scene.nodes) && result.scene.nodes.length === 0, 'missing model did not produce an empty scene')
}

// 5. A seeded 25-node view lays out, merges and lints within 1500 ms; layout.done logged.
{
  const runs = []
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const logger = createLogger()
    const started = performance.now()
    const result = await renderView({ model: perfFixture.model, views: perfFixture.views, overlays: {}, viewId: 'v.flow', logger })
    runs.push({
      layoutMs: Math.round(result.layout.ms * 100) / 100,
      totalMs: Math.round((performance.now() - started) * 100) / 100,
      layoutDone: logger.find('layout.done'),
      lintOk: result.lint.ok,
      nodes: result.scene.nodes.length,
      sceneHash: result.sceneHash,
    })
  }
  const worst = Math.max(...runs.map(run => run.totalMs))
  record('perf25', { runs, worstTotalMs: worst, budgetMs: 1500 })
  require(worst <= 1500 && runs.every(run => run.layoutDone?.nodes === 25), '25-node budget or layout.done missing')
}

// 6. Every lint rule fires at its stated severity from a seeded fixture.
{
  const outcomes = []
  for (const entry of lintCases) {
    const run = renderView({
      model: entry.model,
      views: entry.views,
      overlays: entry.overlays ?? {},
      staleNodeIds: entry.staleNodeIds ?? [],
      viewId: entry.views.views[0].id,
    })
    try {
      const result = await run
      const finding = result.lint.findings.find(item => item.rule === entry.rule)
      outcomes.push({ rule: entry.rule, severity: finding?.severity ?? null, expected: entry.severity, refused: false })
    } catch (error) {
      const finding = error.details?.findings?.find(item => item.rule === entry.rule)
      outcomes.push({ rule: entry.rule, severity: finding?.severity ?? null, expected: entry.severity, refused: error.code })
    }
  }
  const nonFinite = summariseLint(lintScene(nonFiniteScene)).findings.find(item => item.rule === 'non_finite_geometry')
  outcomes.push({ rule: 'non_finite_geometry', severity: nonFinite?.severity ?? null, expected: 'error', refused: 'lint_scene' })
  for (const entry of sceneLintCases) {
    const finding = summariseLint(lintScene(entry.scene)).findings.find(item => item.rule === entry.rule)
    outcomes.push({ rule: entry.rule, severity: finding?.severity ?? null, expected: entry.severity, refused: 'lint_scene' })
  }
  record('lintRules', outcomes)
  require(outcomes.every(item => item.severity === item.expected), 'a lint rule did not fire at its stated severity')
}

// 6b. Readability: every fixture view is collision-free, and the audit can fail.
{
  const roots = ['demo', 'readability']
  const rows = []
  for (const name of roots) {
    const workspace = createWorkspace(fixture(name))
    for (const view of workspace.readViews().views.views) {
      const result = await renderView({
        model: workspace.readModel().model,
        views: workspace.readViews().views,
        overlays: workspace.readOverlays().overlays,
        viewId: view.id,
      })
      const row = auditScene(result.scene)
      rows.push({ fixture: name, ...row })
    }
  }
  // Negative control: the same audit MUST see a plate placed inside a node.
  const clean = await renderView({ ...demoInputs(), viewId: 'v.context' })
  const broken = structuredClone(clean.scene)
  const victim = broken.nodes[0]
  broken.edges[0].labelBox = { x: victim.x + 4, y: victim.y + 4, w: broken.edges[0].labelBox.w, h: broken.edges[0].labelBox.h }
  const brokenRow = auditScene(broken)
  record('readability', {
    views: rows.map(row => ({
      fixture: row.fixture,
      viewId: row.viewId,
      canvas: row.canvas,
      nodes: row.nodes,
      labels: row.labels,
      collisions: row.collisions,
      clearance: row.clearance,
      clean: row.clean,
    })),
    negativeControl: { viewId: brokenRow.viewId, clean: brokenRow.clean, collisions: brokenRow.collisions },
  })
  require(rows.every(row => row.clean), 'a fixture view has a visual collision (labels over nodes, plates over each other, or edges through nodes)')
  require(brokenRow.clean === false && brokenRow.collisions.label_over_node >= 1, 'the readability audit does not catch a plate inside a node')
}

// 7. Bad overlays are ignored with merge.gc warnings; render still succeeds.
{
  const model = {
    schemaVersion: 1,
    groups: [],
    nodes: [
      { id: 'svc.a', type: 'service', label: 'A', group: null, source: null },
      { id: 'db.b', type: 'datastore', label: 'B', group: null, source: null },
      { id: 'queue.c', type: 'queue', label: 'C', group: null, source: null },
      { id: 'ext.d', type: 'external', label: 'D', group: null, source: null },
    ],
    edges: [
      { id: 'e.a.b', from: 'svc.a', to: 'db.b', kind: 'data', label: 'reads' },
      { id: 'e.b.c', from: 'db.b', to: 'queue.c', kind: 'async', label: 'publish' },
      { id: 'e.c.d', from: 'queue.c', to: 'ext.d', kind: 'sync', label: 'charge' },
    ],
  }
  const views = parseViews({ schemaVersion: 1, views: [{ id: 'v.overlays', title: 'Overlays', level: 'context', direction: 'LR' }] })
  const clean = await renderView({ model, views, overlays: {}, viewId: 'v.overlays' })
  const result = await renderView({ model, views, overlays: badOverlays, viewId: 'v.overlays' })
  const cleanNodes = new Map(clean.scene.nodes.map(node => [node.id, node]))
  const nodes = new Map(result.scene.nodes.map(node => [node.id, node]))
  record('overlays', {
    gcCodes: result.merge.gc.map(entry => entry.code),
    applied: result.merge.applied,
    extDPosition: { x: nodes.get('ext.d').x, y: nodes.get('ext.d').y },
    svcAXUnchanged: nodes.get('svc.a').x === cleanNodes.get('svc.a').x,
    dbBXUnchanged: nodes.get('db.b').x === cleanNodes.get('db.b').x,
    colours: [...result.merge.colours.entries()],
    sceneHash: result.sceneHash,
    canvas: result.scene.canvas,
  })
  const codes = report.checks.overlays.gcCodes
  require(['unknown_node', 'negative_coordinate', 'non_finite_coordinate', 'colour_out_of_palette', 'unknown_key'].every(code => codes.includes(code)), 'overlay GC did not report a bad row')
}

// 8. The corrected §8 severities must not change scene bytes; the bundle index exists.
{
  const GOLDEN_SCENE = 'sha256:8b32911c7c898ef2f594669534545797ec9deb3ce2dcf6463c0bc0a7efd14262'
  const scene = await renderView({ ...demoInputs(), viewId: 'v.context' })
  record('sceneBytesUnchanged', { golden: GOLDEN_SCENE, actual: scene.sceneHash, equal: scene.sceneHash === GOLDEN_SCENE })
  require(scene.sceneHash === GOLDEN_SCENE, 'scene bytes changed for the demo fixture')

  const dir = mkdtempSync(join(tmpdir(), 'designmap-index-'))
  cpSync(fixture('demo'), dir, { recursive: true })
  const workspace = createWorkspace(dir)
  const bundle = await renderAll({ workspace })
  const index = JSON.parse(readFileSync(join(dir, 'out', 'index.json'), 'utf8'))
  const scenes = index.views.map(row => ({
    id: row.viewId,
    scenePath: row.scenePath,
    hashMatchesFile: row.sceneHash === sha256(readFileSync(join(dir, row.scenePath), 'utf8')),
    bytes: row.bytes,
  }))
  record('index', {
    indexHash: bundle.indexHash,
    indexPath: workspace.paths.index,
    views: index.views.map(row => row.viewId),
    scenes,
    modelHash: index.modelHash,
    viewsHash: index.viewsHash,
    overlaysHash: index.overlaysHash,
    hashesMatchWorkspace: index.modelHash === workspace.hashOf('model')
      && index.viewsHash === workspace.hashOf('views')
      && index.overlaysHash === workspace.hashOf('overlays'),
  })
  require(index.views.length === 2 && scenes.every(row => row.hashMatchesFile), 'index.json is incomplete or inconsistent')
  rmSync(dir, { recursive: true, force: true })
}

report.ok ? console.log(JSON.stringify(report, null, 2)) : (console.error(JSON.stringify(report, null, 2)), process.exit(1))
