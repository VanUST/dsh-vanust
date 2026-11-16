#!/usr/bin/env node
/**
 * Drive the M3 living-doc loop on a real throw-away git repository and print one JSON
 * report: status -> scan -> apply -> render -> lint -> export, plus the JSONL event
 * counts. This is the product run the acceptance reads; it is not a test runner.
 *
 * Usage: node bin/living-doc.mjs [--keep]
 * Exit 0 only when every check holds; exit 1 with the failed checks listed.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHostService, createFileLogger } from '../src/host.mjs'
import { createHostTools } from '../src/tools.mjs'
import { createCommandHandler } from '../src/command.mjs'

const keep = process.argv.includes('--keep')
const root = mkdtempSync(join(tmpdir(), 'designmap-living-'))
const designmapDir = join(root, 'designmap')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const write = (relative, content) => {
  const path = join(root, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

const MODEL = `schemaVersion: 1
groups: []
nodes:
  - id: svc.checkout.api
    type: service
    label: Checkout API
    group: null
    source: src/checkout/api.ts
  - id: db.orders
    type: datastore
    label: Orders DB
    group: null
    source: src/orders/schema.sql
edges:
  - id: e.api.db
    from: svc.checkout.api
    to: db.orders
    kind: data
    label: SQL / reads
`
const VIEWS = `schemaVersion: 1
views:
  - id: v.context
    title: Checkout — context
    level: context
    direction: LR
    include: []
    parent: null
`
const OVERLAYS = { $version: 1, 'svc.checkout.api': { x: 40, y: 30, fill: '#2563eb', stroke: '#4338ca' } }

git('init', '-q')
git('config', 'user.email', 'designmap@example.test')
git('config', 'user.name', 'Designmap Evidence')
write('src/checkout/api.ts', 'export const api = 1\n')
write('src/orders/schema.sql', 'create table orders(id int);\n')
write('designmap/model.yaml', MODEL)
write('designmap/views.yaml', VIEWS)
write('designmap/overlays.json', `${JSON.stringify(OVERLAYS, null, 2)}\n`)
git('add', '-A')
git('commit', '-qm', 'base')

const hostFor = () => {
  const { logger, path } = createFileLogger(designmapDir)
  return { service: createHostService({ designmapDir, repoRoot: root, logger }), logger, logPath: path }
}
const tools = createHostTools({ defineTool: options => options, hostFor })
const exec = { agent: { session: { header: { cwd: root } } } }
const call = (name, args) => tools.find(tool => tool.name === name).execute(args, exec)
const command = createCommandHandler({ hostFor })

const report = { root, steps: [], checks: {}, failures: [] }
const check = (name, condition, detail) => {
  report.checks[name] = { ok: Boolean(condition), ...(detail === undefined ? {} : { detail }) }
  if (!condition) report.failures.push(name)
}
const overlaysBefore = readFileSync(join(designmapDir, 'overlays.json'), 'utf8')

// 0. baseline sync
const baseline = await call('designmap_apply', { ops: [] })
check('baseline_apply', baseline.ok === true && baseline.applied === 0, { applied: baseline.applied, skipped: baseline.skipped })
report.steps.push({ step: 'apply-baseline', applied: baseline.applied, manifest: baseline.manifest })

// 1. status clean
const cleanStatus = await call('designmap_status', {})
check('status_clean_initially', cleanStatus.stale === false, { stale: cleanStatus.stale, commit: cleanStatus.commit })
report.steps.push({ step: 'status', stale: cleanStatus.stale, commitBehind: cleanStatus.commitBehind })

// 2. real edit: modify one source file, add a new one (nothing committed)
write('src/checkout/api.ts', 'export const api = 2\n')
write('src/billing/refund.ts', 'export const refund = () => 1\n')

// 3. status sees the uncommitted edit
const staleStatus = await call('designmap_status', {})
check('status_stale_after_edit', staleStatus.stale === true && staleStatus.staleNodes.some(node => node.id === 'svc.checkout.api'), staleStatus.staleNodes)
report.steps.push({ step: 'status-after-edit', stale: staleStatus.stale, commitBehind: staleStatus.commitBehind, staleNodes: staleStatus.staleNodes })

// 4. scan proposes, writes nothing
const scan = await call('designmap_scan', {})
const proposal = scan.proposedOps.find(op => op.value?.source === 'src/billing/refund.ts')
check('scan_proposes_new_file', proposal !== undefined, scan.proposedOps)
check('scan_reports_affected_node', scan.affectedNodes.includes('svc.checkout.api'), scan.affectedNodes)
check('scan_writes_nothing', readFileSync(join(designmapDir, 'model.yaml'), 'utf8') === MODEL)
report.steps.push({ step: 'scan', proposedOps: scan.proposedOps, affectedNodes: scan.affectedNodes, changedFiles: scan.changedFiles })

// 5. confirmed apply (proposal + the edge semantics the scan cannot infer)
const confirmed = [
  ...scan.proposedOps,
  { kind: 'edge', action: 'upsert', value: { id: 'e.api.refund', from: 'svc.checkout.api', to: 'src.billing.refund', kind: 'sync', label: 'refund' } },
]
const applied = await call('designmap_apply', { ops: confirmed })
check('apply_confirmed', applied.ok === true && applied.applied === 2, { applied: applied.applied, skipped: applied.skipped })
const reapplied = await call('designmap_apply', { ops: confirmed })
check('apply_idempotent', reapplied.applied === 0 && reapplied.skipped === 2, { applied: reapplied.applied, skipped: reapplied.skipped })
report.steps.push({ step: 'apply', applied: applied.applied, skipped: applied.skipped, idempotent: { applied: reapplied.applied, skipped: reapplied.skipped }, manifest: applied.manifest })

// 6. status is clean again
const syncedStatus = await call('designmap_status', {})
check('status_clean_after_apply', syncedStatus.stale === false && syncedStatus.staleNodes.length === 0, syncedStatus)

// 7. render + lint
const rendered = await call('designmap_render', {})
const scene = rendered.views?.find(view => view.viewId === 'v.context')
check('render_ok', rendered.ok === true && scene !== undefined, { indexPath: rendered.indexPath, indexHash: rendered.indexHash })
check('render_lint_clean', scene?.lint.ok === true, scene?.lint?.counts)
check('render_has_new_node', scene?.scene.nodes.some(node => node.id === 'src.billing.refund') === true)
check('render_not_stale', scene?.stale.stale === false)
const lint = await call('designmap_lint', {})
check('lint_ok', lint.views.every(view => view.lint.ok), lint.views.map(view => view.lint.counts))

// 8. overlay survives + export
check('overlay_file_untouched', readFileSync(join(designmapDir, 'overlays.json'), 'utf8') === overlaysBefore)
const overlaid = scene?.scene.nodes.find(node => node.id === 'svc.checkout.api')
check('overlay_position_in_scene', overlaid?.x === 40 && overlaid?.y === 30, overlaid)
const exported = await call('designmap_export', { viewId: 'v.context' })
const svg = readFileSync(join(root, exported.svgPath), 'utf8')
check('export_ok', exported.ok === true && exported.svgPath === 'designmap/out/v.context.svg', { hash: exported.hash, bytes: exported.bytes })
check('export_has_overlay_position', svg.includes('<rect x="40" y="30"'))
check('export_has_overlay_colour', svg.includes('fill="#2563eb"') && svg.includes('stroke="#4338ca"'))
check('export_has_labels', ['Checkout API', 'Orders DB', 'refund'].every(label => svg.includes(label)))
check('export_is_closed_svg', svg.startsWith('<svg ') && svg.trimEnd().endsWith('</svg>') && !svg.includes('NaN') && !svg.includes('undefined'))
check('export_group_balance', (svg.match(/<g /gu) ?? []).length === (svg.match(/<\/g>/gu) ?? []).length)
report.steps.push({ step: 'export', svgPath: exported.svgPath, hash: exported.hash, bytes: exported.bytes, colours: exported.colours })

// 9. the panel path works too
const commandResult = await command({ agent: exec.agent, rawInput: JSON.stringify({ op: 'status' }) })
check('command_status', commandResult.kind === 'success' && JSON.parse(commandResult.text).stale === false, commandResult.kind)

// 10. every step is in the JSONL log
const logPath = join(designmapDir, 'logs', 'events.jsonl')
const events = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
const counts = events.reduce((accumulator, event) => {
  accumulator[event.event] = (accumulator[event.event] ?? 0) + 1
  return accumulator
}, {})
for (const required of ['tool.enter', 'tool.exit', 'model.diff', 'layout.done', 'merge.applied', 'lint.result', 'render.done']) {
  check(`log_has_${required}`, counts[required] > 0, counts)
}
const loggedTools = [...new Set(events.filter(event => event.event === 'tool.enter').map(event => event.tool))]
check('log_has_every_step', ['designmap_status', 'designmap_scan', 'designmap_apply', 'designmap_render', 'designmap_lint', 'designmap_export'].every(name => loggedTools.includes(name)), loggedTools)
report.steps.push({ step: 'logs', path: logPath, events: counts, loggedTools })

report.ok = report.failures.length === 0
if (!keep) {
  // The artifacts are quoted in the report before cleanup; --keep retains the repo.
  report.kept = false
}
console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exit(1)
