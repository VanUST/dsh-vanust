#!/usr/bin/env node
/**
 * PURPOSE
 *   The README "Role availability" table documents which case tools a preset receives;
 *   `DEFAULT_ROLE_TOOLS` in `plugins/test-cases/test-cases.mjs` is the policy. A reader can compare
 *   the two, so a row that drifts from the map is refused here instead of in the case library: the
 *   rule can only be red on a document, and a document rule belongs to the tree gate
 *   (`make verify`), not to an acceptance case (docs/CASE-LIBRARY-BEHAVIOUR-DESIGN.md, M1).
 *
 * INPUTS
 *   None. Reads `plugins/test-cases/README.md` and imports `DEFAULT_ROLE_TOOLS` from
 *   `plugins/test-cases/test-cases.mjs`, both relative to this script's own location.
 *
 * OUTPUTS
 *   One line per README row, then `role table ok` and exit 0 when the table and the map agree;
 *   the disagreeing rows and verbs on stderr and exit 1 otherwise.
 *
 * WHAT IT CANNOT SEE
 *   The "no preset (standard/headless)" row names no preset and no verb in inline code: it
 *   documents what the host does outside an orchestrated preset, and the map holds no key to
 *   compare it with. It is skipped because it is not a preset row, not as a special exception.
 *
 * KEYWORDS
 *   role availability, DEFAULT_ROLE_TOOLS, README table, preset tool policy, tree check
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_ROLE_TOOLS } from '../plugins/test-cases/test-cases.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

function claim(name, ok, detail) {
  process.stdout.write(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : ` — ${detail}`}
`)
  if (!ok) failures.push(`${name}: ${detail ?? 'no detail'}`)
}

/**
 * The availability table as data: `Map<preset, verbs>`.
 *
 * A row is recognised by its first cell being ONE inline-code span, which is how the table spells
 * a preset name; the verbs are the `case_*` spans of the row. Parsing the table instead of
 * restating the mapping keeps this reader from becoming a third copy of the policy.
 *
 * @returns the rows, or `null` when the section is absent.
 */
function roleTable(text) {
  const section = text.split(/^## Role availability[ \t]*$/m)[1]?.split(/^## /m)[0]
  if (section === undefined) return null
  const rows = new Map()
  for (const line of section.split('\n')) {
    const match = /^\|\s*`([a-z][a-z0-9-]*)`\s*\|(.*)\|\s*$/.exec(line)
    if (match === null) continue
    const verbs = [...match[2].matchAll(/`(case_[a-z_]+)`/g)].map((hit) => hit[1])
    rows.set(match[1], verbs)
  }
  return rows
}

const rows = roleTable(readFileSync(join(KIT, 'plugins', 'test-cases', 'README.md'), 'utf8'))
if (rows === null) {
  process.stderr.write('role table FAILED\n  - plugins/test-cases/README.md has no "## Role availability" section\n')
  process.exit(1)
}

for (const [preset, stated] of rows) {
  if (!Object.hasOwn(DEFAULT_ROLE_TOOLS, preset)) {
    claim(`row ${preset}`, false, 'DEFAULT_ROLE_TOOLS has no such preset')
    continue
  }
  const granted = new Set(DEFAULT_ROLE_TOOLS[preset])
  const listed = new Set(stated)
  const missing = [...granted].filter((verb) => !listed.has(verb))
  const extra = [...listed].filter((verb) => !granted.has(verb))
  const detail = [...missing.map((verb) => `README is missing ${verb}`), ...extra.map((verb) => `README adds ${verb}`)].join(', ')
  claim(`row ${preset}`, missing.length === 0 && extra.length === 0, detail === '' ? `${listed.size} verb(s) agree` : detail)
}

for (const preset of Object.keys(DEFAULT_ROLE_TOOLS)) {
  if (rows.has(preset)) continue
  claim(`row ${preset}`, false, 'the README table has no row for this preset')
}

if (failures.length > 0) {
  process.stderr.write(`role table FAILED\n${failures.map((entry) => `  - ${entry}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('role table ok\n')
