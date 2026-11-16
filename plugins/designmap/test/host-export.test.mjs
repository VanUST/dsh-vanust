/**
 * PROOF:
 * Behavior: export writes one standalone SVG of the MERGED scene — overlay positions
 *   move the node, accepted overlay colours paint it, labels and edge labels appear,
 *   out-of-palette colours never reach the file — and the document is well-formed XML
 *   (FR-8, SCENE-CONTRACT overlay rules; M4 uses this without a browser).
 * Fails when: export re-renders without overlays, colours bypass the palette check,
 *   labels are dropped, the SVG is not closed/balanced, or NaN leaks into geometry.
 * Production path: src/host.mjs exportSvg -> src/render.mjs renderView (overlay merge)
 *   -> src/svg.mjs sceneToSvg.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createHostService, findPngConverter } from '../src/host.mjs'
import { makeRepo } from './host-helpers.mjs'

const OVERLAYS = {
  $version: 1,
  'svc.checkout.api': { x: 40, y: 30, fill: '#2563eb', stroke: '#4338ca' },
}

test('export reflects overlay position and colour and carries the labels', async () => {
  const repo = makeRepo({ overlays: OVERLAYS })
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    service.apply([])
    const exported = await service.exportSvg({ viewId: 'v.context' })
    assert.equal(exported.ok, true)
    assert.equal(exported.svgPath, 'designmap/out/v.context.svg')
    assert.match(exported.hash, /^sha256:[0-9a-f]{64}$/u)
    assert.deepEqual(exported.colours, ['svc.checkout.api'])
    assert.deepEqual(exported.labels.sort(), ['Checkout API', 'Orders DB'])

    const svg = readFileSync(join(repo.root, exported.svgPath), 'utf8')
    assert.ok(svg.startsWith('<svg '), 'root element')
    assert.ok(svg.trimEnd().endsWith('</svg>'), 'closed document')
    assert.equal(svg.includes('NaN'), false)
    assert.equal(svg.includes('undefined'), false)
    // Overlay geometry and accepted colours, on the node group.
    assert.match(svg, /data-node-id="svc\.checkout\.api"/u)
    assert.match(svg, /<rect x="40" y="30" width="140"/u)
    assert.match(svg, /fill="#2563eb"/u)
    assert.match(svg, /stroke="#4338ca"/u)
    // Labels: nodes and the edge label.
    assert.ok(svg.includes('Checkout API'))
    assert.ok(svg.includes('Orders DB'))
    assert.ok(svg.includes('SQL / reads'))
    // Structural balance: every opened group is closed.
    assert.equal((svg.match(/<g /gu) ?? []).length, (svg.match(/<\/g>/gu) ?? []).length)
  } finally {
    repo.cleanup()
  }
})

test('an out-of-palette overlay colour is ignored by the export', async () => {
  const repo = makeRepo({ overlays: { $version: 1, 'svc.checkout.api': { fill: '#ff0000', stroke: '#00ff00' } } })
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    const exported = await service.exportSvg({ viewId: 'v.context' })
    assert.deepEqual(exported.colours, [])
    const svg = readFileSync(join(repo.root, exported.svgPath), 'utf8')
    assert.equal(svg.includes('#ff0000'), false)
    assert.equal(svg.includes('#00ff00'), false)
    // The service palette entry is used instead.
    assert.ok(svg.includes('#e0e7ff'))
    assert.ok(svg.includes('#4338ca'))
  } finally {
    repo.cleanup()
  }
})

test('PNG export is optional: converter present → PNG bytes, absent → named refusal', async t => {
  const repo = makeRepo({ overlays: OVERLAYS })
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    const converter = findPngConverter()
    if (converter === null || converter.missing !== undefined) {
      t.skip('no SVG→PNG converter on this machine')
      return
    }
    const png = await service.exportView({ viewId: 'v.context', format: 'png' })
    assert.equal(png.ok, true)
    assert.equal(png.format, 'png')
    assert.equal(png.pngPath, 'designmap/out/v.context.png')
    const bytes = readFileSync(join(repo.root, png.pngPath))
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    assert.equal(png.pngBytes, bytes.byteLength)
    assert.equal(png.pngHash, `sha256:${createHash('sha256').update(bytes).digest('hex')}`)
    assert.equal(existsSync(join(repo.root, png.svgPath)), true)

    const previous = process.env.DESIGNMAP_PNG_CONVERTER
    process.env.DESIGNMAP_PNG_CONVERTER = '/nonexistent/designmap-converter'
    try {
      await assert.rejects(
        service.exportView({ viewId: 'v.context', format: 'png' }),
        error => error.code === 'png_converter_missing' && error.details.configured === '/nonexistent/designmap-converter',
      )
    } finally {
      if (previous === undefined) delete process.env.DESIGNMAP_PNG_CONVERTER
      else process.env.DESIGNMAP_PNG_CONVERTER = previous
    }
  } finally {
    repo.cleanup()
  }
})

test('export without overlays uses the layout position and palette', async () => {
  const repo = makeRepo()
  try {
    const service = createHostService({ designmapDir: repo.designmapDir, repoRoot: repo.root })
    const rendered = await service.render({ viewId: 'v.context', write: false })
    const exported = await service.exportSvg({ viewId: 'v.context' })
    const node = rendered.scene.nodes.find(candidate => candidate.id === 'db.orders')
    const svg = readFileSync(join(repo.root, exported.svgPath), 'utf8')
    assert.ok(svg.includes(`<rect x="${node.x}" y="${node.y}"`))
    assert.ok(svg.includes('#fef3c7'))
  } finally {
    repo.cleanup()
  }
})
