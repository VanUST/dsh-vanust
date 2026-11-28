#!/usr/bin/env node
/**
 * PURPOSE
 *   The README "Role availability" table documents which case tools a preset receives, and
 *   `DEFAULT_ROLE_TOOLS` in `plugins/test-cases/test-cases.mjs` is the policy. A reader can compare
 *   the two, so a row that drifts from the map is refused here instead of in the case library: the
 *   rule can only be red on a document, and a document rule belongs to the tree gate
 *   (`make verify`), not to an acceptance case (docs/CASE-LIBRARY-BEHAVIOUR-DESIGN.md, M1).
 *
 *   The PROFILE is the third copy of that rule: `families.<preset>.allow` in
 *   `profile/cordis.patch.yml` decides which tools survive in a deployed preset, and until this
 *   check read it a role could lose a case verb the map still promised it (backend lost
 *   `case_update`, so the case it authored could not be re-pinned). The profile row is compared
 *   with the SAME map instead of restating the verbs here, so the two cannot drift apart quietly.
 *
 * INPUTS
 *   None by default. Reads `plugins/test-cases/README.md`, `profile/cordis.patch.yml` and imports
 *   `DEFAULT_ROLE_TOOLS` from `plugins/test-cases/test-cases.mjs`, all relative to this script's
 *   own location. `--profile <path>` reads another profile (the red-first fixture of
 *   scripts/test/check-role-table.test.mjs).
 *
 * OUTPUTS
 *   One line per README row and per profile row, then `role table ok` and exit 0 when the table,
 *   the profile and the map agree; the disagreeing rows and verbs on stderr and exit 1 otherwise.
 *
 * WHAT IT CANNOT SEE
 *   The "no preset (standard/headless)" row names no preset and no verb in inline code: it
 *   documents what the host does outside an orchestrated preset, and the map holds no key to
 *   compare it with. It is skipped because it is not a preset row, not as a special exception.
 *   A preset the map names and the profile has no row for is NOT drift: a row-less preset keeps
 *   its full surface, so no promised verb is removed. The check compares the rows the profile
 *   writes, and refuses a profile that lists a case verb the map does not grant.
 *
 * KEYWORDS
 *   role availability, DEFAULT_ROLE_TOOLS, README table, preset tool policy, profile allow list,
 *   tree check
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_ROLE_TOOLS } from '../plugins/test-cases/test-cases.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The availability table as data: `Map<preset, verbs>`.
 *
 * A row is recognised by its first cell being ONE inline-code span, which is how the table spells
 * a preset name; the verbs are the `case_*` spans of the row. Parsing the table instead of
 * restating the mapping keeps this reader from becoming a third copy of the policy.
 *
 * @returns the rows, or `null` when the section is absent.
 */
export function roleTable(text) {
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

/**
 * The case verbs each preset's allow list names in the tool-families row of a profile.
 *
 * A third copy of the role rule is worth reading only against the map, so this returns the
 * `case_*` subset per preset and leaves every other family alone: the profile is also the place
 * where a role's shell, browser and MCP families are narrowed, and that narrowing is its job.
 * The block is located by its plugin id and the rows by indentation, the same way
 * scripts/audit-preset-composition.mjs reads it, so a comment or a byte-budget row cannot be
 * mistaken for an allow list.
 *
 * @returns `Map<preset, string[]>`, in profile order.
 */
export function profileCaseVerbs(text) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => /^\s+- id: tool-families\s*$/.test(line))
  if (start < 0) throw new Error('the profile has no "- id: tool-families" row')
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*- insert:/.test(lines[index])) { end = index; break }
    if (/^\s*# /.test(lines[index]) && /^# -- /.test(lines[index].trim())) { end = index; break }
  }
  const block = lines.slice(start, end)
  const at = block.findIndex((line) => /^\s*families:\s*$/.test(line))
  if (at < 0) throw new Error('the tool-families row has no families block')
  const base = block[at].match(/^\s*/)[0].length
  const out = new Map()
  let preset = null
  let list = null
  for (let index = at + 1; index < block.length; index += 1) {
    const line = block[index]
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const indent = line.match(/^\s*/)[0].length
    if (indent <= base) break
    const head = /^\s*([a-z]+):\s*$/.exec(line)
    if (indent === base + 2 && head !== null) {
      preset = head[1]
      out.set(preset, [])
      list = null
      continue
    }
    if (preset === null) continue
    const listHead = /^\s*(allow|deny|projectDeny):\s*$/.exec(line)
    if (indent === base + 4 && listHead !== null) { list = listHead[1]; continue }
    if (list !== 'allow') continue
    const item = /^\s*-\s+(\S+)\s*$/.exec(line)
    if (item !== null && item[1].startsWith('case_')) out.get(preset).push(item[1])
  }
  return out
}

/**
 * Run the whole check: the README table and the profile rows against the map.
 *
 * @param {{ profilePath?: string }} options
 * @returns {{ executed: number, failures: string[] }}
 */
export function checkRoleTable({ profilePath = join(KIT, 'profile', 'cordis.patch.yml') } = {}) {
  const failures = []
  let executed = 0
  const claim = (name, ok, detail) => {
    executed += 1
    process.stdout.write(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : ` — ${detail}`}\n`)
    if (!ok) failures.push(`${name}: ${detail ?? 'no detail'}`)
  }

  const rows = roleTable(readFileSync(join(KIT, 'plugins', 'test-cases', 'README.md'), 'utf8'))
  if (rows === null) {
    claim('README', false, 'plugins/test-cases/README.md has no "## Role availability" section')
    return { executed, failures }
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

  let profile
  try {
    profile = profileCaseVerbs(readFileSync(profilePath, 'utf8'))
  } catch (error) {
    claim('profile', false, `${profilePath}: ${error instanceof Error ? error.message : String(error)}`)
    return { executed, failures }
  }
  for (const [preset, listed] of profile) {
    const granted = new Set(DEFAULT_ROLE_TOOLS[preset] ?? [])
    const named = new Set(listed)
    const missing = [...granted].filter((verb) => !named.has(verb))
    const extra = [...named].filter((verb) => !granted.has(verb))
    const detail = [...missing.map((verb) => `profile is missing ${verb}`), ...extra.map((verb) => `profile adds ${verb}`)].join(', ')
    claim(`profile row ${preset}`, missing.length === 0 && extra.length === 0, detail === '' ? `${named.size} case verb(s) agree` : detail)
  }
  return { executed, failures }
}

/** CLI entry: print the verdict and return the exit code. */
export function main(argv = process.argv.slice(2)) {
  const flag = argv.indexOf('--profile')
  const profilePath = flag === -1 ? undefined : argv[flag + 1]
  if (flag !== -1 && (profilePath === undefined || profilePath.startsWith('--'))) {
    process.stderr.write('usage: node scripts/check-role-table.mjs [--profile <path>]\n')
    return 2
  }
  const { failures } = checkRoleTable({ profilePath })
  if (failures.length > 0) {
    process.stderr.write(`role table FAILED\n${failures.map((entry) => `  - ${entry}`).join('\n')}\n`)
    return 1
  }
  process.stdout.write('role table ok\n')
  return 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
