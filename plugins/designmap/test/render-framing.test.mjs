/*
PROOF: map_render frames the whole page instead of cropping it to a fixed viewport
Behavior: pageBounds folds in shapes, their bound labels and arrow points; frameFor returns a
  viewport, zoom and scroll that put every corner of those bounds inside the visible area with
  a small padding; the imported system page (11 nodes, 12 edges, 46 elements) is taller than the
  old 700 px capture and frames to a viewport that contains it; an empty page frames to a small
  picture and says empty.
Fails when: the extent ignores bound labels or arrow points (a label clippith at the edge), the
  framing math puts a corner outside the viewport, or an empty page is treated as an error.
Production path: plugins/designmap/src/excalidraw-render.mjs (pageBounds, frameFor, the headless
  capture) via src/ops.mjs renderPage -> command render-page -> map_render.
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pageBounds, frameFor } from '../src/excalidraw-render.mjs'

// The subject is the repository's own imported page; the suite runs from the repository root.
const scene = JSON.parse(readFileSync(join(process.cwd(), 'designmap', 'pages', 'system.excalidraw'), 'utf8'))

/** The scene-space rectangle the framed view can show: (point + scroll) * zoom is on screen. */
function visibleRect(frame) {
  const left = -frame.scrollX
  const top = -frame.scrollY
  return { left, top, right: left + frame.viewport.width / frame.zoom, bottom: top + frame.viewport.height / frame.zoom }
}

test('the imported page frames completely, though it is taller than the old 700 px capture', () => {
  const bounds = pageBounds(scene.elements)
  assert.equal(bounds.empty, false)
  assert.equal(bounds.width, 239)
  assert.equal(bounds.height, 1096)
  assert.ok(bounds.height > 700, 'the page is taller than the old fixed capture')
  const frame = frameFor(bounds)
  const visible = visibleRect(frame)
  assert.ok(bounds.x >= visible.left && bounds.y >= visible.top, 'top-left corner is inside the view')
  assert.ok(bounds.x + bounds.width <= visible.right && bounds.y + bounds.height <= visible.bottom, 'bottom-right corner is inside the view')
  assert.ok(frame.viewport.height >= bounds.height, 'the viewport is at least as tall as the page')
})

test('the extent includes bound labels and arrow points, not just shapes', () => {
  const shapesOnly = scene.elements.filter((element) => element.type === 'rectangle')
  const withEverything = pageBounds(scene.elements)
  const shapeBounds = pageBounds(shapesOnly)
  assert.ok(withEverything.width >= shapeBounds.width, 'labels or arrows widen the extent')
  const arrow = scene.elements.find((element) => element.type === 'arrow')
  assert.ok(Array.isArray(arrow.points) && arrow.points.length > 1)
  // An arrow whose points reach past every shape must extend the bounds.
  const probe = [
    { id: 's', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
    { id: 'a', type: 'arrow', x: 0, y: 0, points: [[0, 0], [0, -40]] },
  ]
  assert.equal(pageBounds(probe).y, -40, 'the arrow point above the shape is part of the bounds')
  assert.equal(pageBounds(probe).height, 50)
})

test('an empty page frames a small picture and says it is empty', () => {
  const frame = frameFor(pageBounds([]))
  assert.equal(frame.empty, true)
  assert.equal(frame.zoom, 1)
  assert.ok(frame.viewport.width > 0 && frame.viewport.height > 0)
  assert.deepEqual(frame.bounds, { x: 0, y: 0, width: 0, height: 0, empty: true })
})
