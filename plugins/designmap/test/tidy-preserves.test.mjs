/*
PROOF: tidy repositions elements instead of rebuilding them, so a labelled arrow keeps its label
Behavior: tidyElements over the imported system page returns every element the page had (46 in,
  46 out, no id lost), including the text element e.orch.designmap:label bound to the arrow
  e.orch.designmap, and reports the overlap count before and after.
Fails when: tidy re-emits shapes through the builder and drops the bound texts of arrows whose
  endpoints it did not place - the measured defect 46 -> 45 with the label gone.
Production path: plugins/designmap/src/tidy.mjs (tidyElements) via src/ops.mjs applyOp('tidy-page')
  -> command tidy-page -> map_edit and the panel's Tidy button.
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tidyElements } from '../src/tidy.mjs'

const scene = JSON.parse(readFileSync(join(process.cwd(), 'designmap', 'pages', 'system.excalidraw'), 'utf8'))

test('a tidied page keeps every element, its labelled arrow included', () => {
  const before = scene.elements
  const result = tidyElements(before)
  assert.equal(result.elements.length, before.length, 'tidy must not drop an element')
  const ids = new Set(result.elements.map((element) => element.id))
  for (const element of before) assert.ok(ids.has(element.id), `${element.id} survived the tidy`)
  const label = result.elements.find((element) => element.id === 'e.orch.designmap:label')
  assert.ok(label !== undefined, "the labelled arrow's text is still in the page")
  assert.equal(label.containerId, 'e.orch.designmap')
  assert.equal(typeof label.text, 'string')
  assert.ok(result.overlapsAfter <= result.overlapsBefore)
})
