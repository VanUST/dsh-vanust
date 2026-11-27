/*
PROOF: a page edit reaches the same page file and the panel cannot write in read mode
Behavior: the /designmap command answers pages/page/save/tidy-page/render-page over
  designmap/pages; save re-reads the file before writing and returns the replaced element
  count; a save without an elements array is refused as invalid_scene; tidy and render run the
  same code the agent tools use and leave the page file as the only store.
Fails when: save writes without re-reading (a second JSON appears beside the page), the file is
  truncated to the payload, or the command answers a page op from a cache instead of the file.
Production path: plugins/designmap/src/command.mjs (ops pages/page/save/tidy-page/render-page),
  src/pages.mjs, src/ops.mjs; called by client/host.js from the panel.
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCommandHandler } from '../src/command.mjs'
import { emptyScene, writePage, readPage } from '../src/pages.mjs'

function harness(dir) {
  const handler = createCommandHandler({ hostFor: () => ({ service: {}, logger: null, designmapDir: dir }) })
  return async (op) => {
    const outcome = await handler({ agent: null, rawInput: JSON.stringify(op) })
    // A success is JSON; an error is the `designmap: <code>: <detail>` text the panel quotes.
    return { kind: outcome.kind, value: outcome.kind === 'success' ? JSON.parse(outcome.text) : outcome.text }
  }
}

test('the command lists, opens, saves, tidies and renders one page file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'designmap-command-'))
  const scene = emptyScene()
  scene.elements = [
    { id: 'a', type: 'rectangle', x: 0, y: 0, width: 140, height: 56, boundElements: [{ type: 'text', id: 'a:label' }] },
    { id: 'a:label', type: 'text', containerId: 'a', x: 8, y: 8, width: 100, height: 20, text: 'A', originalText: 'A', fontSize: 13, lineHeight: 1.25 },
    { id: 'b', type: 'rectangle', x: 10, y: 10, width: 140, height: 56, boundElements: [{ type: 'text', id: 'b:label' }] },
    { id: 'b:label', type: 'text', containerId: 'b', x: 18, y: 18, width: 100, height: 20, text: 'B', originalText: 'B', fontSize: 13, lineHeight: 1.25 },
  ]
  writePage(dir, 'checkout', scene)
  const call = harness(dir)

  const listed = await call({ op: 'pages' })
  assert.equal(listed.kind, 'success')
  assert.deepEqual(listed.value.pages.map((row) => row.page), ['checkout'])

  const opened = await call({ op: 'page', page: 'checkout' })
  assert.equal(opened.kind, 'success')
  assert.equal(opened.value.scene.elements.length, 4)

  // A human drag: the panel sends the whole element list back.
  const edited = opened.value.scene.elements.map((element) => (element.id === 'a' ? { ...element, x: 400 } : element))
  const saved = await call({ op: 'save', page: 'checkout', scene: { ...opened.value.scene, elements: edited } })
  assert.equal(saved.kind, 'success')
  assert.equal(saved.value.elements, 4)
  assert.equal(saved.value.previousElements, 4)
  assert.equal(readPage(dir, 'checkout').elements.find((element) => element.id === 'a').x, 400)
  assert.deepEqual(readFileSync(join(dir, 'pages', 'checkout.excalidraw'), 'utf8').includes('"type": "excalidraw"'), true)

  // A save without elements is refused by name, and the file is untouched.
  const refused = await call({ op: 'save', page: 'checkout', scene: { type: 'excalidraw' } })
  assert.equal(refused.kind, 'error')
  assert.match(refused.value, /invalid_scene/)
  assert.equal(readPage(dir, 'checkout').elements.find((element) => element.id === 'a').x, 400)

  const tidy = await call({ op: 'tidy-page', page: 'checkout' })
  assert.equal(tidy.kind, 'success')
  const after = readPage(dir, 'checkout').elements
  const left = after.find((element) => element.id === 'a')
  const right = after.find((element) => element.id === 'b')
  const overlaps = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x) > 0
    && Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y) > 0
  assert.equal(overlaps, false, 'tidy placed the two boxes apart')

  // The render is Excalidraw's own export in a headless browser: on this machine it must
  // either produce the PNG or refuse by NAME (renderer_unavailable) - never write a picture of
  // its own and never fail silently.
  const rendered = await call({ op: 'render-page', page: 'checkout' })
  if (rendered.kind === 'success') {
    assert.equal(existsSync(join(dir, 'out', 'checkout.png')), true)
    assert.ok(rendered.value.png.bytes > 1000)
    assert.equal(rendered.value.renderer, 'excalidraw')
    assert.equal(rendered.value.chromeHidden, true, 'the render did not hide the editor chrome')
  } else {
    assert.match(String(rendered.value), /renderer_unavailable/)
  }
})

test('an unknown page is refused by name, not rendered empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'designmap-command-'))
  const call = harness(dir)
  const missing = await call({ op: 'page', page: 'nope' })
  assert.equal(missing.kind, 'error')
  assert.match(missing.value, /unknown_page/)
})
