#!/usr/bin/env node
/**
 * PURPOSE
 *   Every preset carries a two-direction playbook in its persona, and the shared specialist
 *   policy carries the acceptance sentence and the case contract. A reader cannot recover those
 *   texts: an edit that shortens a persona, a renamed preset row or a repack from an older tree
 *   drops them without failing anything. This reader asserts their ANCHORS in the tree, so
 *   `make verify` refuses the loss.
 *
 *   IT ASSERTS ANCHORS, NOT WORDS. The block text has exactly one copy per role: the persona in
 *   `profile/cordis.patch.yml`, plus the shared paragraph in `CHILD_POLICY` of
 *   `plugins/orchestrator/orchestrator.mjs`; this file must not become a second one, so it names
 *   the stable opening phrases and nothing that would have to be maintained twice.
 *
 * INPUTS
 *   None. Reads `profile/cordis.patch.yml` and `plugins/orchestrator/orchestrator.mjs`, and
 *   imports `DEFAULT_ROLE_TOOLS` from `plugins/test-cases/test-cases.mjs`, all relative to this
 *   script's own location.
 *
 * OUTPUTS
 *   One PASS line per preset, one for preset coverage, one for the roles that carry case tools
 *   and one for the child policy, then `prompt playbooks ok` and exit 0; the failing claims on
 *   stderr and exit 1.
 *
 * WHAT IT CANNOT SEE
 *   Presence is not meaning: a block can keep both anchors and say something else. Whether the
 *   two directions are the RIGHT ones for the role is a review item, judged against the
 *   playbook block in the role's persona and the two failure directions in §7 of
 *   docs/ARCHITECTURE.md.
 *   It also cannot see the profile a server boots: it reads the kit's own
 *   `profile/cordis.patch.yml`, so a deployed copy that differs from it is outside this check.
 *
 * KEYWORDS
 *   preset playbook, persona, false positive, false negative, child policy, acceptance sentence,
 *   tree check
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
 * The anchor each preset must keep.
 *
 * Eleven roles name the two directions of a false result with the same words, because they are
 * the same idea seen from the oracle and from the probe. The orchestrator states them in its own
 * sentence - it closes tasks, so its false positive is a closure and its false negative is
 * ceremony - and is checked for its own phrasing rather than bent to the other eleven.
 */
const PLAYBOOK = {
  orchestrator: ['Two ways it becomes false', 'The opposite failure'],
  architect: ['False positive:', 'False negative:'],
  ux: ['False positive:', 'False negative:'],
  presenter: ['False positive:', 'False negative:'],
  backend: ['False positive:', 'False negative:'],
  devops: ['False positive:', 'False negative:'],
  research: ['False positive:', 'False negative:'],
  gatherer: ['False positive:', 'False negative:'],
  reviewer: ['False positive:', 'False negative:'],
  critic: ['False positive:', 'False negative:'],
  tester: ['False positive:', 'False negative:'],
  docs: ['False positive:', 'False negative:'],
}

/**
 * The persona text of every `- id: preset-<name>` row in the profile.
 *
 * A persona is a `prefix: |-` literal block under the preset's persona plugin row; the block ends
 * at the first line that is neither blank nor indented to the block's own depth.
 *
 * @returns `Map<preset, text | null>`, `null` for a preset row with no persona block.
 */
function personas(text) {
  const lines = text.split('\n')
  const found = new Map()
  for (let index = 0; index < lines.length; index += 1) {
    const row = /^    - id: preset-([a-z][a-z0-9-]*)$/.exec(lines[index])
    if (row === null) continue
    let start = -1
    for (let scan = index + 1; scan < index + 25 && scan < lines.length; scan += 1) {
      if (/^\s+prefix: \|-$/.test(lines[scan])) { start = scan; break }
    }
    if (start < 0) { found.set(row[1], null); continue }
    let end = start + 1
    while (end < lines.length && (lines[end].trim() === '' || /^\s{16}\S/.test(lines[end]))) end += 1
    found.set(row[1], lines.slice(start + 1, end).join('\n'))
  }
  return found
}

/** The shared child policy as the module writes it, fences included. */
function childPolicy(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.startsWith('const CHILD_POLICY = `'))
  if (start < 0) return null
  const end = lines.findIndex((line, index) => index > start && line.endsWith('`'))
  if (end < 0) return null
  return lines.slice(start, end + 1).join('\n')
}

const rows = personas(readFileSync(join(KIT, 'profile', 'cordis.patch.yml'), 'utf8'))

for (const [preset, anchors] of Object.entries(PLAYBOOK)) {
  const persona = rows.get(preset)
  if (persona === undefined || persona === null) {
    claim(`preset ${preset}`, false, 'the profile has no preset row with a persona prefix')
    continue
  }
  const missing = anchors.filter((anchor) => !persona.includes(anchor))
  claim(
    `preset ${preset}`,
    missing.length === 0,
    missing.length === 0 ? `${anchors.length} anchors present` : `missing ${missing.map((anchor) => `"${anchor}"`).join(' and ')}`,
  )
}

// FAIL CLOSED IN BOTH DIRECTIONS. A dropped row must not read as "nothing to check", and a
// renamed row must not shrink coverage while this file still lists the full roster.
const known = Object.keys(PLAYBOOK).sort()
const present = [...rows.keys()].sort()
const absent = known.filter((preset) => !rows.has(preset))
const unknown = present.filter((preset) => !(preset in PLAYBOOK))
claim(
  'preset coverage',
  present.length > 0 && absent.length === 0 && unknown.length === 0,
  absent.length === 0 && unknown.length === 0
    ? `${present.length} preset rows, exactly the twelve this check knows`
    : [...absent.map((preset) => `no persona row for ${preset}`), ...unknown.map((preset) => `row ${preset} is not a preset this check knows`)].join('; '),
)

// A role that carries case tools must have a persona to carry its playbook.
const roles = Object.keys(DEFAULT_ROLE_TOOLS)
const roleMissing = roles.filter((preset) => !rows.has(preset))
claim(
  'a persona for every role with case tools',
  roleMissing.length === 0,
  roleMissing.length === 0 ? `${roles.length} DEFAULT_ROLE_TOOLS presets covered` : `no persona row for ${roleMissing.join(', ')}`,
)

const policy = childPolicy(readFileSync(join(KIT, 'plugins', 'orchestrator', 'orchestrator.mjs'), 'utf8'))
if (policy === null) {
  claim('CHILD_POLICY', false, 'plugins/orchestrator/orchestrator.mjs has no CHILD_POLICY block')
} else {
  const required = ['**How your result is accepted.**', 'case_gate']
  const forbidden = ['documented-only with a reason']
  const missing = required.filter((anchor) => !policy.includes(anchor))
  const kept = forbidden.filter((anchor) => policy.includes(anchor))
  claim(
    'CHILD_POLICY',
    missing.length === 0 && kept.length === 0,
    missing.length === 0 && kept.length === 0
      ? 'acceptance sentence and case_gate present; the documented-only escape is gone'
      : [...missing.map((anchor) => `missing "${anchor}"`), ...kept.map((anchor) => `still offers "${anchor}"`)].join('; '),
  )
}

if (failures.length > 0) {
  process.stderr.write(`prompt playbooks FAILED
${failures.map((entry) => `  - ${entry}`).join('\n')}
`)
  process.exit(1)
}
process.stdout.write('prompt playbooks ok\n')
