/*
PROOF: the profile row, the README table and DEFAULT_ROLE_TOOLS are one policy
Behavior: scripts/check-role-table.mjs compares families.<preset>.allow in the real
  profile with DEFAULT_ROLE_TOOLS as well as the README table; a profile row that loses a
  case verb the map grants is refused with the preset and the verb named (exit 1), and the
  real profile passes (exit 0) with one line per profile row.
Fails when: the profile is not read at all (the pre-fix checker passed the drifted row), a
  removed verb is not named, the row is not counted, or the fixed profile is refused.
Production path: scripts/check-role-table.mjs — roleTable, profileCaseVerbs, checkRoleTable
  and main; the map and the README table it compares. The role rule lives in
  plugins/test-cases/test-cases.mjs (DEFAULT_ROLE_TOOLS); this test does not restate it.
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(KIT, 'scripts', 'check-role-table.mjs')
const PROFILE = join(KIT, 'profile', 'cordis.patch.yml')
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''

/** Run the checker against a profile; return its exit code and streams. */
function run(profilePath) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--profile', profilePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    return { code: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') }
  }
}

/**
 * The profile before this change: the backend allow row without the three verbs the map
 * promises it. The row is cut out of the REAL file, so the fixture is the profile the
 * deployment shipped, not a profile nobody wrote; the other rows stay as they are.
 */
function withoutBackendCaseRepair(text, verbs) {
  const lines = text.split(/\r?\n/)
  const familiesAt = lines.findIndex((line) => /^\s*families:\s*$/.test(line))
  assert.notEqual(familiesAt, -1, 'the real profile has no families block')
  const base = lines[familiesAt].match(/^\s*/)[0].length
  const rowAt = lines.findIndex((line, index) => index > familiesAt && line === ' '.repeat(base + 2) + 'backend:')
  assert.notEqual(rowAt, -1, 'the real profile has no backend row')
  let end = lines.length
  for (let index = rowAt + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() !== '' && line.match(/^\s*/)[0].length <= base + 2) { end = index; break }
  }
  const removed = new Set(verbs)
  return lines
    .filter((line, index) => index <= rowAt || index >= end || !removed.has((/^\s*-\s+(case_[a-z_]+)\s*$/.exec(line) ?? [])[1]))
    .join('\n')
}

function withProfile(text) {
  const dir = mkdtempSync(join(tmpdir(), 'role-table-'))
  const path = join(dir, 'cordis.patch.yml')
  writeFileSync(path, text)
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('the real profile gives every role the case verbs the map promises', () => {
  const result = run(PROFILE)
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /role table ok/)
  assert.match(result.stdout, /profile row backend — 7 case verb\(s\) agree/)
})

test('a profile row that loses a promised case verb is refused, by role and verb', () => {
  const preFix = withProfile(withoutBackendCaseRepair(readFileSync(PROFILE, 'utf8'), ['case_update', 'case_verify', 'case_suite']))
  try {
    const result = run(preFix.path)
    assert.equal(result.code, 1, 'the checker accepted a row that lost case_update')
    assert.match(result.stderr, /profile row backend: profile is missing case_update/)
  } finally {
    preFix.cleanup()
  }
})

test('negative control expect-no-profile-check: the pre-fix checker passed the drifted row', () => {
  if (control !== 'expect-no-profile-check') return
  const preFix = withProfile(withoutBackendCaseRepair(readFileSync(PROFILE, 'utf8'), ['case_update', 'case_verify', 'case_suite']))
  try {
    const result = run(preFix.path)
    assert.equal(result.code, 0, 'the profile is read now; the pre-fix checker ignored it')
  } finally {
    preFix.cleanup()
  }
})
