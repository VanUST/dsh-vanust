/*
PROOF: the agent drawing instruments (AC-3, AC-4, AC-5, AC-6) and the one-file page format (NFR2).
Behavior: the registered map tools turn one `diagram` op into laid-out nodes and edges with the
  labels in the gaps; `map_lint` returns measured findings with element ids and a working repair,
  `map_read` carries geometry and a verdict, and a crowded page is still writable; three
  coordinate-less `node.add` calls spread out instead of stacking; `map_render` frames the picture
  to the page bounds with no editor chrome; every operation keeps one Excalidraw page file.
Fails when: a diagram overlaps nodes or ignores the requested direction, a finding has no id or
  no repair, a crowded page is refused, node.add falls back to the old vertical column, the render
  shows the toolbar/menu, or a second store appears next to the page file.
Production path: plugins/designmap/src/page-tools.mjs, ops.mjs, lint.mjs, outline.mjs,
  excalidraw-render.mjs, pages.mjs.
*/
import { join } from 'node:path'
import {
  argCase, boxesOverlap, commandHandler, contentBounds, filesUnder, pageFile, readPng,
  runCase, shapesOf, tempDesignmap, toolSurface,
} from './lib.mjs'

const CASE = argCase()

function noOverlaps(shapes) {
  const pairs = []
  for (let left = 0; left < shapes.length; left += 1) {
    for (let right = left + 1; right < shapes.length; right += 1) {
      if (boxesOverlap(shapes[left], shapes[right])) pairs.push(`${shapes[left].id}/${shapes[right].id}`)
    }
  }
  return pairs
}

async function newPage(tools, slug) {
  const created = await tools.call('map_edit', { page: slug, op: 'page.create' })
  if (created?.ok !== true) throw new Error(`page.create ${slug} failed: ${JSON.stringify(created)}`)
}

async function sceneOf(tools, slug) {
  const read = await tools.call('map_read', { page: slug, format: 'json' })
  if (read?.ok !== true) throw new Error(`map_read ${slug} failed: ${JSON.stringify(read)}`)
  return read
}

runCase(CASE, async ({ check, equal, log }) => {
  const { dir } = tempDesignmap()
  const tools = await toolSurface(dir)
  log('tree', process.cwd(), 'tools', tools.names.join(','))

  if (CASE === 'AC-3') {
    check(tools.names.includes('map_edit'), 'map_edit is a registered tool')
    check(tools.names.includes('map_read'), 'map_read is a registered tool')
    await newPage(tools, 'flow')
    const drawn = await tools.call('map_edit', {
      page: 'flow', op: 'diagram', direction: 'LR',
      nodes: [{ label: 'CLI' }, { label: 'Orchestrator' }, { label: 'Taskboard' }, { label: 'Store' }],
      edges: [
        { from: 'CLI', to: 'Orchestrator', label: 'asks' },
        { from: 'Orchestrator', to: 'Taskboard', label: 'writes' },
        { from: 'Taskboard', to: 'Store', label: 'keeps' },
      ],
    })
    log('diagram result', JSON.stringify({ ok: drawn?.ok, nodes: drawn?.nodes, edges: drawn?.edges, notes: drawn?.notes }))
    check(drawn?.ok === true, `one diagram op returns ok (got ${JSON.stringify(drawn).slice(0, 200)})`)
    equal(drawn?.nodes, 4, 'the diagram created all four nodes')
    equal(drawn?.edges, 3, 'the diagram created all three edges')

    const read = await sceneOf(tools, 'flow')
    const scene = pageFile(dir, 'flow')
    const shapes = shapesOf(scene)
    equal(shapes.length, 4, 'the page file holds four node boxes')
    const overlaps = noOverlaps(shapes)
    check(overlaps.length === 0, `no two nodes overlap (overlapping pairs: ${overlaps.join(', ') || 'none'})`)
    check(read.readability?.verdict === 'clean', `the laid-out diagram reads clean (verdict ${read.readability?.verdict}, score ${read.readability?.score})`)

    const byLabel = new Map(shapes.map((shape) => {
      const label = (scene.elements ?? []).find((entry) => entry?.type === 'text' && entry.containerId === shape.id)
      return [String(label?.text ?? '').trim(), shape]
    }))
    for (const name of ['CLI', 'Orchestrator', 'Taskboard', 'Store']) check(byLabel.has(name), `node "${name}" exists with its label`)
    const chain = ['CLI', 'Orchestrator', 'Taskboard', 'Store'].map((name) => byLabel.get(name))
    if (!chain.some((shape) => shape === undefined)) {
      const xs = chain.map((shape) => shape.x)
      check(xs.every((x, index) => index === 0 || x > xs[index - 1]), `LR places the four nodes left to right (x: ${xs.join(' < ')})`)
      const ys = chain.map((shape) => shape.y)
      check(Math.max(...ys) - Math.min(...ys) < 20, `LR keeps the chain on one row (y: ${ys.join(', ')})`)
    }

    const arrows = (scene.elements ?? []).filter((entry) => entry?.type === 'arrow' && entry.isDeleted !== true)
    equal(arrows.length, 3, 'the page file holds three arrows')
    let labelsInGaps = 0
    for (const arrow of arrows) {
      const from = shapes.find((shape) => shape.id === arrow.startBinding?.elementId)
      const to = shapes.find((shape) => shape.id === arrow.endBinding?.elementId)
      const text = (scene.elements ?? []).find((entry) => entry?.type === 'text' && entry.containerId === arrow.id)
      if (from === undefined || to === undefined || text === undefined) continue
      const labelBox = { x: text.x, y: text.y, width: text.width, height: text.height }
      const between = labelBox.x >= from.x + from.width - 1 && labelBox.x + labelBox.width <= to.x + 1
      const hitsNode = shapes.some((shape) => boxesOverlap(labelBox, shape))
      if (between && !hitsNode) labelsInGaps += 1
      else log('label not in gap', text.text, JSON.stringify(labelBox), JSON.stringify({ from: from.id, to: to.id }))
    }
    equal(labelsInGaps, 3, 'every edge label sits in the gap between its two boxes')
    return
  }

  if (CASE === 'AC-4') {
    check(tools.names.includes('map_lint'), 'map_lint is a registered tool')
    await newPage(tools, 'crowded')
    // A deliberately bad page: two boxes on top of each other, one without a label, one too
    // narrow for its text. A crowded page is a report, not a refusal.
    await tools.call('map_edit', { page: 'crowded', op: 'node.add', label: 'Checkout API', x: 40, y: 40 })
    await tools.call('map_edit', { page: 'crowded', op: 'node.add', label: 'Payment API', x: 50, y: 50 })
    await tools.call('map_edit', { page: 'crowded', op: 'node.add', x: 400, y: 40 })
    const narrow = await tools.call('map_edit', { page: 'crowded', op: 'node.add', label: 'Warehouse reconciliation service', x: 600, y: 40 })
    if (narrow?.ok === true && typeof narrow.id === 'string') {
      await tools.call('map_edit', { page: 'crowded', op: 'node.resize', id: narrow.id, width: 60 })
    }
    const scene = pageFile(dir, 'crowded')
    const ids = new Set((scene.elements ?? []).map((entry) => entry?.id))
    const lint = await tools.call('map_lint', { page: 'crowded' })
    log('map_lint', JSON.stringify({ ok: lint?.ok, score: lint?.score, verdict: lint?.verdict, findings: (lint?.findings ?? []).map((entry) => entry.code) }))
    check(lint?.ok === true, `map_lint answers on a crowded page instead of refusing it (got ${JSON.stringify(lint).slice(0, 180)})`)
    check(lint?.verdict !== 'clean', `the crowded page is not called clean (verdict ${lint?.verdict})`)
    check(Array.isArray(lint?.findings) && lint.findings.length >= 2, `map_lint returns findings (${lint?.findings?.length ?? 0})`)
    let measured = 0
    let repaired = 0
    let repair = null
    for (const finding of lint?.findings ?? []) {
      const hasIds = Array.isArray(finding.elements) && finding.elements.length > 0 && finding.elements.every((id) => ids.has(id))
      const numbers = finding.measure !== null && typeof finding.measure === 'object' ? Object.values(finding.measure).filter((value) => Number.isFinite(value)) : []
      const hasRepair = finding.repair !== null && typeof finding.repair === 'object' && typeof finding.repair.op === 'string' && finding.repair.op.length > 0
      if (hasIds) measured += 1
      else log('finding without known ids', JSON.stringify(finding).slice(0, 200))
      check(hasIds, `finding ${finding.code} names element ids that exist on the page (${finding.elements?.join(', ')})`)
      check(numbers.length > 0, `finding ${finding.code} carries a measured value (${JSON.stringify(finding.measure)})`)
      check(hasRepair, `finding ${finding.code} carries a repair op (${JSON.stringify(finding.repair)})`)
      if (hasRepair && finding.repair.op === 'node.move' && repair === null) repair = finding.repair
    }
    check(measured >= 2, 'at least two findings name real element ids')
    const read = await sceneOf(tools, 'crowded')
    check(Array.isArray(read.geometry) && read.geometry.length === shapesOf(scene).length, `map_read carries one geometry row per box (${read.geometry?.length})`)
    check(read.geometry.every((row) => Number.isFinite(row.x) && Number.isFinite(row.y) && Number.isFinite(row.width) && Number.isFinite(row.height)), 'every geometry row carries x, y, width and height')
    check(Number.isFinite(read.readability?.score) && typeof read.readability?.verdict === 'string', `map_read carries a readability verdict (${read.readability?.score}/100 ${read.readability?.verdict})`)
    const write = await tools.call('map_edit', { page: 'crowded', op: 'node.add', label: 'Retry queue', x: 900, y: 400 })
    check(write?.ok === true, 'a crowded page is never refused a write (node.add answered ok)')
    if (repair !== null) {
      const applied = await tools.call('map_edit', { page: 'crowded', ...repair })
      check(applied?.ok === true, `the proposed repair runs (${JSON.stringify(repair)})`)
      const after = await tools.call('map_lint', { page: 'crowded' })
      const same = (after?.findings ?? []).filter((entry) => entry.code === 'node_overlap' && entry.elements?.includes(repair.id))
      repaired = same.length
      check(repaired < 2, `the repair clears the overlap it named for ${repair.id} (overlap findings left: ${repaired})`)
    } else {
      check(false, 'map_lint proposed a node.move repair for the overlapping boxes')
    }
    return
  }

  if (CASE === 'AC-5') {
    await newPage(tools, 'free')
    for (const label of ['First', 'Second', 'Third']) {
      const added = await tools.call('map_edit', { page: 'free', op: 'node.add', label })
      log('node.add', label, JSON.stringify({ ok: added?.ok, id: added?.id, hints: added?.hints?.length }))
      check(added?.ok === true, `node.add "${label}" without coordinates is accepted`)
    }
    const scene = pageFile(dir, 'free')
    const shapes = shapesOf(scene)
    equal(shapes.length, 3, 'three nodes were placed')
    const bounds = contentBounds(shapes)
    log('bounds', JSON.stringify(bounds), 'x', shapes.map((shape) => shape.x).join(','), 'y', shapes.map((shape) => shape.y).join(','))
    check(bounds.width > bounds.height, `the page bounds are wider than tall (${bounds.width}x${bounds.height})`)
    const overlaps = noOverlaps(shapes)
    check(overlaps.length === 0, `the free spots do not overlap (pairs: ${overlaps.join(', ') || 'none'})`)
    return
  }

  if (CASE === 'AC-6') {
    await newPage(tools, 'empty')
    const empty = await tools.call('map_render', { page: 'empty' })
    log('render empty', JSON.stringify({ ok: empty?.ok, png: empty?.png?.path, width: empty?.width, height: empty?.height }))
    check(empty?.ok === true && typeof empty?.png?.path === 'string', `map_render produced a PNG for an empty page (${JSON.stringify(empty).slice(0, 200)})`)
    if (typeof empty?.png?.path === 'string') {
      const png = await readPng(empty.png.path)
      const colours = [...png.colours.entries()].sort((left, right) => right[1] - left[1])
      log('empty picture', `${png.width}x${png.height}`, 'distinct colours', png.colours.size, 'top', JSON.stringify(colours[0]))
      check(png.colours.size === 1, `an empty page renders one flat background - no toolbar, menu or bottom bar pixels (distinct colours: ${png.colours.size})`)
    }

    await newPage(tools, 'wide')
    await tools.call('map_edit', {
      page: 'wide', op: 'diagram', direction: 'LR',
      nodes: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
      edges: [{ from: 'A', to: 'B', label: 'one' }, { from: 'B', to: 'C', label: 'two' }],
    })
    const wideScene = pageFile(dir, 'wide')
    const wideBounds = contentBounds(shapesOf(wideScene))
    const wide = await tools.call('map_render', { page: 'wide' })
    check(wide?.ok === true && typeof wide?.png?.path === 'string', 'map_render produced a PNG for the wide diagram')
    if (typeof wide?.png?.path === 'string') {
      const png = await readPng(wide.png.path)
      log('wide picture', `${png.width}x${png.height}`, 'page bounds', JSON.stringify(wideBounds), 'render bounds', JSON.stringify(wide?.bounds))
      // The picture follows the page's shape; a viewport-shaped capture or a toolbar band
      // would not change orientation with the page.
      check(png.width / png.height > 2, `the picture follows the page shape (${png.width}x${png.height}, page ${wideBounds.width}x${wideBounds.height})`)
    }
    await newPage(tools, 'tall')
    await tools.call('map_edit', {
      page: 'tall', op: 'diagram', direction: 'TB',
      nodes: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
      edges: [{ from: 'A', to: 'B', label: 'one' }, { from: 'B', to: 'C', label: 'two' }],
    })
    const tall = await tools.call('map_render', { page: 'tall' })
    check(tall?.ok === true && typeof tall?.png?.path === 'string', 'map_render produced a PNG for the top-down diagram')
    if (typeof tall?.png?.path === 'string') {
      const png = await readPng(tall.png.path)
      log('tall picture', `${png.width}x${png.height}`, 'page bounds', JSON.stringify(tall?.bounds))
      check(png.height > png.width, `the top-down page renders taller than wide (${png.width}x${png.height})`)
    }
    return
  }

  if (CASE === 'REQ-255') {
    await newPage(tools, 'format')
    await tools.call('map_edit', {
      page: 'format', op: 'diagram', direction: 'LR',
      nodes: [{ label: 'A' }, { label: 'B' }],
      edges: [{ from: 'A', to: 'B', label: 'asks' }],
    })
    await tools.call('map_lint', { page: 'format' })
    const render = await tools.call('map_render', { page: 'format' })
    check(render?.ok === true, 'map_render ran on the page')
    const files = filesUnder(dir).sort()
    log('files under the designmap dir', JSON.stringify(files))
    const pageFiles = files.filter((name) => name.endsWith('.excalidraw'))
    equal(pageFiles.length, 1, `the design map is one Excalidraw file (${pageFiles.join(', ')})`)
    const stores = files.filter((name) => !name.endsWith('.excalidraw') && !name.startsWith('out/'))
    equal(stores.length, 0, `no second store sits next to the page (other files: ${stores.join(', ') || 'none'})`)
    const scene = pageFile(dir, 'format')
    equal(scene.type, 'excalidraw', 'the page file keeps the Excalidraw document type')
    check(Array.isArray(scene.elements), 'the page file keeps its elements array')
    const read = await sceneOf(tools, 'format')
    equal(read.nodes, 2, 'a reload reads the same two nodes from the page file')
    equal(read.edges, 1, 'a reload reads the same edge from the page file')
    return
  }

  throw new Error(`unknown case ${CASE}`)
})

async function readPngPixels(path) {
  const { readPng: read } = await import('./lib.mjs')
  const png = await read(path)
  // readPng returns colour counts; decode the raw bytes once more for the row scan.
  const { PNG } = await import((await import('node:url')).pathToFileURL(join(process.env.DM_ROOT ?? process.cwd(), '.tools', 'node_modules', 'pngjs', 'lib', 'png.js')).href)
  const { readFileSync } = await import('node:fs')
  const raw = PNG.sync.read(readFileSync(path))
  return raw
}
