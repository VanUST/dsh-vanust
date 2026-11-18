/*
PROOF: panel navigation controls live in the panel, not in the taskboard strip or the session header
Behavior: the taskboard client registers only the Tasks panel in main, the designmap client registers
  only the Design map panel in main (its bundle rebuilt from client/entry.jsx), and the state panel
  renders Back to chat, the left-sidebar toggle and a right-column toggle whose aria-pressed and
  label ("Скрыть правую колонку" / "Показать правую колонку") reflect the ps-rail's presence.
Fails when: conversation.session.header.actions is registered again in the taskboard or designmap
  client, the taskboard header button (aria-label "Open tasks") or the designmap HeaderTrigger comes
  back, the panel loses Back to chat / the sidebar toggle / the rail toggle and its state, or the
  rail stops leaving the grid when it is hidden. CASE_NEGATIVE_CONTROL=expect-pre-fix flips the
  assertions to the pre-fix shape, which must fail on the fixed files (the measured red).
Production path: plugins/taskboard/client.js, plugins/project-state-panel/client.js,
  plugins/designmap/client/entry.jsx and its built plugins/designmap/client.js; the browser proof is
  taken by the orchestrator on a second server, this test is the static regression.
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
  const entry = read('plugins/designmap/client/entry.jsx')
  const bundle = read('plugins/designmap/client.js')
  const found = []
  if (control === 'expect-pre-fix') {
    // The pre-fix shape: both header triggers are registered and the panel has no rail toggle.
    if (!/conversation\.session\.header\.actions/.test(taskboard)) found.push('pre-fix control: the taskboard header slot is absent (expected it before the fix)')
    if (!/TasksTrigger/.test(taskboard)) found.push('pre-fix control: TasksTrigger is absent (expected it before the fix)')
    if (!/conversation\.session\.header\.actions/.test(entry)) found.push('pre-fix control: the designmap header slot is absent from entry.jsx (expected it before the fix)')
    if (!/HeaderTrigger/.test(entry)) found.push('pre-fix control: HeaderTrigger is absent from entry.jsx (expected it before the fix)')
    if (!/HeaderTrigger/.test(bundle)) found.push('pre-fix control: HeaderTrigger is absent from the built client.js (expected it before the fix)')
    if (/aria-pressed': !railOpen/.test(panel)) found.push('pre-fix control: the rail toggle is already present (expected it absent before the fix)')
    return found
  }
  // Taskboard: the header entry is gone, the panel in main stays.
  if (/conversation\.session\.header\.actions/.test(taskboard)) found.push('conversation.session.header.actions is still registered in plugins/taskboard/client.js')
  if (/TasksTrigger/.test(taskboard)) found.push('TasksTrigger is still declared in plugins/taskboard/client.js')
  if (/Open tasks/.test(taskboard)) found.push('the taskboard header button (aria-label "Open tasks") is still declared')
  if (!/name: 'main'/.test(taskboard) || !/key: PANEL_ID/.test(taskboard)) found.push('the Tasks panel registration in main is missing from plugins/taskboard/client.js')
  // Designmap: the source no longer registers the header entry and the bundle is built from it.
  if (/conversation\.session\.header\.actions/.test(entry)) found.push('conversation.session.header.actions is still registered in plugins/designmap/client/entry.jsx')
  if (/HeaderTrigger/.test(entry)) found.push('HeaderTrigger is still declared in plugins/designmap/client/entry.jsx')
  if (/conversation\.session\.header\.actions/.test(bundle)) found.push('conversation.session.header.actions is still registered in the built plugins/designmap/client.js')
  if (/HeaderTrigger/.test(bundle)) found.push('HeaderTrigger is still declared in the built plugins/designmap/client.js')
  if (/Open the design map/.test(bundle)) found.push('the designmap header button (aria-label "Open the design map") is still declared')
  if (!/name: "main"/.test(bundle) || !/key: "designmap"/.test(bundle)) found.push('the Design map panel registration in main is missing from the built plugins/designmap/client.js')
  if (!/function LivePanel\(/.test(bundle)) found.push('the built plugins/designmap/client.js lost the LivePanel the entry.jsx defines (stale or hand-edited bundle)')
  // State panel: leave, left column, and the right-column toggle.
  if (!/Back to chat/.test(panel)) found.push('Back to chat is missing from plugins/project-state-panel/client.js')
  if (!/toggleSidebar\(\)/.test(panel)) found.push('layout.toggleSidebar() is missing from plugins/project-state-panel/client.js')
  if (!/setExpanded\(\s*sessionId\s*,\s*false\s*\)/.test(panel)) found.push('right-column reset setExpanded(sessionId, false) is missing from plugins/project-state-panel/client.js')
  if (!/selectPanel\(null\)/.test(panel)) found.push('Back to chat does not call layout.selectPanel(null)')
  if (!/const \[railOpen, setRailOpen\] = useState\(true\)/.test(panel)) found.push('the panel does not keep the evidence-rail state (railOpen)')
  if (!/aria-pressed': !railOpen/.test(panel)) found.push('the right-column toggle does not reflect the rail state in aria-pressed')
  if (!/Скрыть правую колонку/.test(panel) || !/Показать правую колонку/.test(panel)) found.push('the right-column toggle label does not switch between "Скрыть правую колонку" and "Показать правую колонку"')
  if (!/railOpen \? h\('div', \{ className: 'ps-rail', id: 'ps-rail' \}/.test(panel)) found.push('the ps-rail is not rendered conditionally on railOpen')
  if (!/\.ps-shell\.ps-no-rail \{ grid-template-columns: 212px minmax\(0, 1fr\); \}/.test(panel)) found.push('the grid keeps the third column when the rail is hidden (no .ps-shell.ps-no-rail rule)')
  return found
}

test('panel navigation invariants', () => {
  const found = violations()
  const summary = JSON.stringify({ metrics: { violations: found.length } })
  process.stdout.write(`CASE_SUMMARY ${summary}\n`)
  if (typeof process.env.CASE_SUMMARY === 'string' && process.env.CASE_SUMMARY !== '') writeFileSync(process.env.CASE_SUMMARY, summary)
  assert.deepEqual(found, [], found.join('; '))
})
