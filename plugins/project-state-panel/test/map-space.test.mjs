/*
PROOF: the Design map mode gives the Excalidraw page the whole panel body
Behavior: when the state panel renders the map mode, the section carries ps-main-map; its CSS
  drops the body padding and page scroll, and the map stage becomes a flex child that fills the
  section instead of a fixed `min(64vh, 620px)` box with a border. The other modes keep their
  document padding and scrolling.
Fails when: the 620px ceiling or the page scroll comes back, the stage stops flexing, or the
  map class stops being applied in map mode (the editor then renders in a strip again).
  CASE_NEGATIVE_CONTROL=expect-pre-fix asserts the pre-fix ceiling and the old render branch,
  which fails on this build - the measured red.
Production path: plugins/project-state-panel/client.js - the CSS block and the mode == 'map'
  branch that hosts PageEditor inside .ps-mapstage.
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.env.PANEL_ROOT ?? process.cwd()
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''
const SOURCE = readFileSync(join(ROOT, 'plugins/project-state-panel/client.js'), 'utf8')

const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return SOURCE.match(new RegExp(`${escaped} \\{[^}]*\\}`))?.[0] ?? ''
}

test('negative control expect-pre-fix keeps the fixed map height', () => {
  if (control !== 'expect-pre-fix') return
  assert.match(SOURCE, /height: min\(64vh, 620px\)/)
  assert.doesNotMatch(SOURCE, /ps-main ps-main-map/)
})

test('the map stage no longer has a fixed 620px ceiling', () => {
  assert.doesNotMatch(SOURCE, /min\(64vh/, 'the map is capped again')
  const stage = rule('.ps-mapstage')
  assert.match(stage, /height: 100%/, `stage rule: ${stage}`)
  assert.match(stage, /border: 0/)
})

test('the map body removes the reading padding and page scroll', () => {
  const main = rule('.ps-main-map')
  assert.match(main, /padding: 0/, `map main rule: ${main}`)
  assert.match(main, /overflow: hidden/)
  assert.match(main, /display: flex/)
  const stage = rule('.ps-main-map .ps-mapstage')
  assert.match(stage, /flex: 1/, `map stage rule: ${stage}`)
})

test('map mode is the mode that carries the class', () => {
  assert.match(SOURCE, /mode === 'map' \? 'ps-main ps-main-map' : 'ps-main'/)
  assert.match(SOURCE, /ps-mapstage/, 'the map stage disappeared')
  assert.match(SOURCE, /data-designmap-page-editor/)
})
