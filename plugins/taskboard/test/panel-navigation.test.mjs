/*
PROOF: panel navigation controls live in the panel, not in the taskboard strip
Behavior: the taskboard client no longer declares the sidebar.panellist entry, and the state
  panel renders Back to chat, the left-sidebar toggle and the right-column reset
  (setExpanded(sessionId, false)) so a person can leave the panel and restore the shell.
Fails when: sidebar.panellist is back in the taskboard client, or the panel loses Back to chat,
  the sidebar toggle, or the right-column reset. CASE_NEGATIVE_CONTROL=expect-pre-fix flips the
  assertions to the pre-fix shape, which must fail on the fixed files (the measured red).
Production path: plugins/taskboard/client.js and plugins/project-state-panel/client.js; the
  browser proof is reports/u5/proof-u5.json, this test is the static regression.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.env.PANEL_ROOT ?? process.cwd()
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

function violations() {
  const taskboard = read('plugins/taskboard/client.js')
  const panel = read('plugins/project-state-panel/client.js')
  const found = []
  if (control === 'expect-pre-fix') {
    // The pre-fix shape: the strip still registers the panel list, the panel has no Back to chat.
    if (!/sidebar\.panellist/.test(taskboard)) found.push('pre-fix control: sidebar.panellist is absent (expected it before the fix)')
    if (/Back to chat/.test(panel)) found.push('pre-fix control: Back to chat already exists (expected it absent before the fix)')
    return found
  }
  if (/sidebar\.panellist/.test(taskboard)) found.push('sidebar.panellist is still declared in plugins/taskboard/client.js')
  if (!/TasksTrigger/.test(taskboard)) found.push('TasksTrigger is missing from plugins/taskboard/client.js')
  if (!/Back to chat/.test(panel)) found.push('Back to chat is missing from plugins/project-state-panel/client.js')
  if (!/toggleSidebar\(\)/.test(panel)) found.push('layout.toggleSidebar() is missing from plugins/project-state-panel/client.js')
  if (!/setExpanded\(\s*sessionId\s*,\s*false\s*\)/.test(panel)) found.push('right-column reset setExpanded(sessionId, false) is missing from plugins/project-state-panel/client.js')
  if (!/selectPanel\(null\)/.test(panel)) found.push('Back to chat does not call layout.selectPanel(null)')
  return found
}

test('panel navigation invariants', () => {
  const found = violations()
  const summary = JSON.stringify({ metrics: { violations: found.length } })
  process.stdout.write(`CASE_SUMMARY ${summary}\n`)
  if (typeof process.env.CASE_SUMMARY === 'string' && process.env.CASE_SUMMARY !== '') writeFileSync(process.env.CASE_SUMMARY, summary)
  assert.deepEqual(found, [], found.join('; '))
})
