/**
 * PROOF:
 * Behavior: the owner-spec §9 living-doc loop runs end to end through the real tools on
 *   a real source edit — status reports stale nodes, scan proposes semantic ops without
 *   writing, the confirmed apply writes them + the manifest and is idempotent, render
 *   and lint come back clean, and a human overlay (position + colour) survives the
 *   regeneration; every step is visible in logs/events.jsonl.
 * Fails when: status cannot see an uncommitted edit, scan writes, apply is not
 *   idempotent, render refuses a model the scan/apply cycle just produced, overlays are
 *   lost or overwritten, or an event is missing from the log stream.
 * Production path: src/tools.mjs tools -> src/host.mjs status/scan/apply/render/lint/
 *   exportSvg -> src/apply.mjs / src/render.mjs / src/index-file.mjs / src/svg.mjs.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHostService, createFileLogger } from '../src/host.mjs'
import { PALETTE } from '../src/palette.mjs'
import { createHostTools } from '../src/tools.mjs'
import { makeRepo, stubDefineTool } from './host-helpers.mjs'

const OVERLAYS = { $version: 1, 'svc.checkout.api': { x: 40, y: 30, fill: PALETTE.frontend.stroke, stroke: PALETTE.frontend.stroke } }

test('living-doc loop on a real edit: status -> scan -> apply -> render -> lint, overlay survives', async () => {
  const repo = makeRepo({ overlays: OVERLAYS })
  try {
    const hostFor = () => {
      const { logger, path } = createFileLogger(repo.designmapDir)
      return { service: createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root, logger }), logger, logPath: path }
    }
    const tools = createHostTools({ defineTool: stubDefineTool, hostFor })
    const exec = { agent: { session: { header: { cwd: repo.root } } } }
    const call = async (name, args) => {
      const value = await tools.find(tool => tool.name === name).execute(args, exec)
      assert.ok(value !== undefined, `${name} returned nothing`)
      return value
    }
    const overlaysBefore = readFileSync(join(repo.designmapDir, 'overlays.json'), 'utf8')

    // Baseline: the map is synced with the code.
    assert.equal((await call('designmap_apply', { ops: [] })).ok, true)
    assert.equal((await call('designmap_status', {})).stale, false)

    // A real change: one file edited, one source file added (nothing committed).
    repo.write('src/checkout/api.ts', 'export const api = 2\n')
    repo.write('src/billing/refund.ts', 'export const refund = () => 1\n')

    // 1. status: the uncommitted edit is visible through the manifest hash.
    const stale = await call('designmap_status', {})
    assert.equal(stale.stale, true)
    assert.equal(stale.commitBehind, 0)
    assert.deepEqual(stale.staleNodes, [{ id: 'svc.checkout.api', source: 'src/checkout/api.ts', reason: 'source_changed' }])

    // 2. scan: proposes the new file as a node, never writes.
    const scan = await call('designmap_scan', {})
    assert.equal(scan.ok, true)
    assert.deepEqual(scan.affectedNodes, ['svc.checkout.api'])
    const proposal = scan.proposedOps.find(op => op.value?.source === 'src/billing/refund.ts')
    assert.ok(proposal, `scan did not propose the new file: ${JSON.stringify(scan.proposedOps)}`)
    assert.equal(proposal.value.id, 'src.billing.refund')
    const modelAfterScan = readFileSync(join(repo.designmapDir, 'model.yaml'), 'utf8')
    assert.equal(modelAfterScan.includes('src.billing.refund'), false, 'scan must not write')

    // 3. Confirm: the agent/human attaches the meaning scan cannot infer (the edge),
    //    then apply runs the whole confirmed batch.
    const confirmed = [
      ...scan.proposedOps,
      { kind: 'edge', action: 'upsert', value: { id: 'e.api.refund', from: 'svc.checkout.api', to: 'src.billing.refund', kind: 'sync', label: 'refund' } },
    ]
    const applied = await call('designmap_apply', { ops: confirmed })
    assert.equal(applied.ok, true)
    assert.equal(applied.applied, 2)
    assert.equal(applied.written.manifest, true)
    assert.equal(applied.diff.counts.added, 2)

    // Idempotent re-apply: nothing changes.
    const again = await call('designmap_apply', { ops: confirmed })
    assert.equal(again.applied, 0)
    assert.equal(again.skipped, 2)
    assert.equal(again.written.model, false)

    // 4. status is clean again (uncommitted edits are now in the manifest).
    const clean = await call('designmap_status', {})
    assert.equal(clean.stale, false)
    assert.deepEqual(clean.staleNodes, [])

    // 5. render: the new node and edge are in the scene; lint is clean; nothing stale.
    const rendered = await call('designmap_render', {})
    assert.equal(rendered.ok, true)
    assert.equal(rendered.indexPath, 'designmap/out/index.json')
    const scene = rendered.views.find(view => view.viewId === 'v.context')
    assert.ok(scene)
    assert.equal(scene.lint.ok, true)
    assert.equal(scene.stale.stale, false)
    assert.ok(scene.scene.nodes.some(node => node.id === 'src.billing.refund'))
    assert.ok(scene.scene.edges.some(edge => edge.id === 'e.api.refund'))

    // 6. lint tool agrees, without writing.
    const lint = await call('designmap_lint', {})
    assert.equal(lint.views.every(view => view.lint.ok), true)

    // 7. The human overlay survived: position and colour still in the scene and SVG.
    assert.equal(readFileSync(join(repo.designmapDir, 'overlays.json'), 'utf8'), overlaysBefore)
    const overlaid = scene.scene.nodes.find(node => node.id === 'svc.checkout.api')
    assert.equal(overlaid.x, 40)
    assert.equal(overlaid.y, 30)
    const exported = await call('designmap_export', { viewId: 'v.context' })
    assert.deepEqual(exported.colours, ['svc.checkout.api'])
    const svg = readFileSync(join(repo.root, exported.svgPath), 'utf8')
    assert.match(svg, /<rect x="40" y="30" width="140"/u)
    assert.ok(svg.includes(`fill="${PALETTE.frontend.stroke}"`))
    assert.ok(svg.includes('refund'))

    // 8. Every step is visible in the JSONL log.
    const events = readFileSync(join(repo.designmapDir, 'logs', 'events.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    const names = new Set(events.map(event => event.event))
    for (const required of ['tool.enter', 'tool.exit', 'model.diff', 'layout.done', 'merge.applied', 'lint.result', 'render.done']) {
      assert.ok(names.has(required), `missing ${required}`)
    }
    const steps = events.filter(event => event.event === 'tool.enter').map(event => event.tool)
    for (const step of ['designmap_status', 'designmap_scan', 'designmap_apply', 'designmap_render', 'designmap_lint', 'designmap_export']) {
      assert.ok(steps.includes(step), `missing ${step} in the log`)
    }
  } finally {
    repo.cleanup()
  }
})
