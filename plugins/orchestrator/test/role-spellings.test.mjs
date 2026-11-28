/*
PROOF: every role spelling the guide documents resolves to the preset it names
Behavior: the "Roles and presets" table in docs/GUIDE.md is parsed as data; every spelling in the
  second column must resolve through presetForRole to the preset id in the first column (the
  orchestrator row is the root policy, not a child preset, and is checked for presence only).
  Every child preset in PRESET_IDS must own a row, so a new role cannot be added without a
  documented spelling and a documented role cannot be renamed without the code agreeing.
Fails when: a spelling in the guide is not in ROLE_PRESETS (the OPS defect: the requirement named
  OPS, the guide would have named OPS, and presetForRole returned undefined), or a preset exists
  with no documented row.
Production path: plugins/orchestrator/orchestrator.mjs (PRESET_IDS, ROLE_PRESETS, presetForRole)
  and docs/GUIDE.md §4.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PRESET_IDS, presetForRole } from '../orchestrator.mjs'

const GUIDE = readFileSync(join(process.cwd(), 'docs/GUIDE.md'), 'utf8')

/** The rows of the §4 table: `| preset | role names | ... |` inside "## 4. Roles and presets". */
function roleTable(text) {
  const section = text.split(/^## 4\. Roles and presets[ \t]*$/m)[1]?.split(/^## /m)[0] ?? ''
  const rows = []
  for (const line of section.split('\n')) {
    const match = /^\|\s*`([a-z][a-z0-9-]*)`\s*\|\s*([^|]+?)\s*\|/.exec(line)
    if (match === null) continue
    rows.push({ preset: match[1], names: match[2].split(',').map((name) => name.trim()).filter((name) => name !== '') })
  }
  return rows
}

test('the guide documents a row for every child preset, and only known presets', () => {
  const rows = roleTable(GUIDE)
  assert.ok(rows.length > 0, 'docs/GUIDE.md §4 has no preset table')
  const documented = rows.map((row) => row.preset)
  const missing = PRESET_IDS.filter((preset) => !documented.includes(preset))
  assert.deepEqual(missing, [], 'a child preset exists with no row in docs/GUIDE.md §4: ' + missing.join(', '))
  const unknown = documented.filter((preset) => preset !== 'orchestrator' && !PRESET_IDS.includes(preset))
  assert.deepEqual(unknown, [], 'the guide documents a preset the code does not know: ' + unknown.join(', '))
})

test('every documented role spelling resolves to the preset the row names', () => {
  const problems = []
  for (const row of roleTable(GUIDE)) {
    if (row.preset === 'orchestrator') continue
    for (const name of row.names) {
      const resolved = presetForRole(name)
      if (resolved !== row.preset) problems.push(name + ' -> ' + String(resolved) + ' (expected ' + row.preset + ')')
    }
  }
  assert.deepEqual(problems, [], 'documented spellings do not resolve: ' + problems.join('; '))
})
