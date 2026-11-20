/*
PROOF: the status chip's popup follows the theme, and the tests table shows no Evidence column
Behavior: the status chip is a NATIVE select wearing the status colours, so the browser draws its
  option list. MDN (<option>, Chromium): "Chromium may additionally allow color, background-color,
  font-family, font-variant, and text-align to be set" - so the popup is styled through the option
  elements, and the chip itself carries an OPAQUE surface background so the list never falls back to
  the default white sheet while the text inherits the status colour (the owner's "white window with
  yellow text"). The status colour stays in the chip's own text and border. The tests table has
  three columns - Test, Requirement, Status - because the evidence of a test is shown in its card
  and its id in the trace matrix, so a fourth chip row repeated it.
Fails when: the chip goes back to a translucent background, an option loses its explicit colour,
  the status colour is dropped from the chip, or the Evidence column comes back.
Production path: plugins/project-state-panel/client.js - the `.ps-status.ps-statusselect*` rules
  and TestsTable.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.env.PANEL_ROOT ?? process.cwd()
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''
const SOURCE = readFileSync(join(ROOT, 'plugins/project-state-panel/client.js'), 'utf8')

test('negative control expect-pre-fix keeps the pre-fix popup shape', () => {
  if (control !== 'expect-pre-fix') return
  // The pre-fix shape: no option colours and an Evidence column in the tests table. Both must
  // fail on the fixed file - that is the red.
  assert.doesNotMatch(SOURCE, /\.ps-status\.ps-statusselect option \{/)
  assert.match(SOURCE, /h\('th', \{ scope: 'col' \}, 'Evidence'\)/)
})

test('the status chip carries an opaque surface background', () => {
  const rule = SOURCE.match(/\.ps-status\.ps-statusselect \{[^}]*\}/)?.[0] ?? ''
  assert.match(rule, /background: var\(--ps-surface\)/, `the chip rule is translucent: ${rule.slice(0, 200)}`)
})

test('every option names the theme surface and ink', () => {
  assert.match(
    SOURCE,
    /\.ps-status\.ps-statusselect option \{ background-color: var\(--ps-surface\); color: var\(--ps-ink\); \}/,
  )
})

test('the status colour stays in the chip text', () => {
  for (const tone of ['active', 'done']) {
    assert.match(SOURCE, new RegExp(`\\.ps-status\\.${tone}[^{]*\\{[^}]*color: var\\(--ps-`), `${tone} lost its status colour`)
  }
})

test('the tests table has three columns and no Evidence', () => {
  assert.doesNotMatch(SOURCE, /h\('th', \{ scope: 'col' \}, 'Evidence'\)/, 'the Evidence column is back')
  const table = SOURCE.match(/function TestsTable[\s\S]{0,1200}/)?.[0] ?? ''
  for (const header of ["'Test'", "'Requirement'", "'Status'"]) assert.ok(table.includes(header), `the tests table lost ${header}`)
  assert.equal(table.includes("'Evidence'"), false, 'the tests table still names Evidence')
})
