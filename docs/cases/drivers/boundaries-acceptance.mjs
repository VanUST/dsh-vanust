#!/usr/bin/env node
/*
PROOF: the architecture-boundaries gate refuses a reach into the harness and a second writer, a
legal tree passes, and every exception must name an owner and a reason (a stale one refuses too).
Behavior: the invariants I-SEAM-ONLY (no import into the installed harness or inside a harness
  package outside the seam) and I-ONE-WRITER (no second writer of a state path outside its owner)
  are refused by `node scripts/check-boundaries.mjs --check` with exit 1; the kit tree passes with
  exit 0; each named exception in the report carries an owner and a reason; a tree where the
  excepted code is gone refuses with a STALE EXCEPTION.
Fails when: an injected harness reach or a foreign board write passes the gate, the legal tree is
  refused, an exception has no owner or reason, a stale exception is not a finding, or the check
  is absent and the gate silently reports success.
Production path: scripts/check-boundaries.mjs (--check, --json, --root), driven through its exit
  code and JSON report only.
*/
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'check-boundaries.mjs')
let failures = 0
const check = (ok, message) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + message)
  if (!ok) failures += 1
}
const run = (args, cwd) => {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' })
  let json = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    json = null
  }
  return { status: result.status, stderr: String(result.stderr ?? '').trim(), json }
}

// A. The legal kit tree: the gate passes and the exception list carries owners and reasons.
const legal = run(['--check', '--json'], ROOT)
check(legal.status === 0, `the kit tree passes the gate (exit ${legal.status})`)
check(legal.json !== null && legal.json.open.length === 0 && legal.json.stale.length === 0,
  `no open findings and no stale exceptions (${legal.json === null ? legal.stderr : 'open ' + legal.json.open.length + ', stale ' + legal.json.stale.length})`)
check(legal.json !== null && legal.json.waived.length > 0 && legal.json.waived.every((entry) => typeof entry.exception?.owner === 'string' && entry.exception.owner !== '' && typeof entry.exception?.reason === 'string' && entry.exception.reason !== ''),
  'every excepted finding names an owner and a reason')

// B. A copy of the tree where the excepted code still matches, plus an injected violation:
//    an import into the installed harness and a foreign write of a board state path.
const fixture = mkdtempSync(join(tmpdir(), 'boundaries-acceptance-'))
for (const file of [
  'plugins/run-code-projection/run-code-projection.mjs',
  'plugins/tool-families/tool-families.mjs',
  'scripts/state-merge.mjs',
  'scripts/state-migrate.mjs',
  'scripts/taskboard-migrate.mjs',
]) {
  mkdirSync(dirname(join(fixture, file)), { recursive: true })
  copyFileSync(join(ROOT, file), join(fixture, file))
}
mkdirSync(join(fixture, 'plugins', 'foreign'), { recursive: true })
writeFileSync(join(fixture, 'plugins', 'foreign', 'foreign.mjs'), [
  "import { types } from '@deepseek-ai/dsh-subagent/lib/types.js'",
  "import { writeFileSync } from 'node:fs'",
  "writeFileSync('taskboard.rows.json', '[]')",
  '',
].join('\n'))
const injected = run(['--check', '--json', '--root', fixture], ROOT)
const injectedRules = new Set((injected.json?.open ?? []).map((finding) => finding.rule))
check(injected.status === 1, `the injected harness reach and foreign board write are refused (exit ${injected.status})`)
check(injectedRules.has('I-SEAM-ONLY') && injectedRules.has('I-ONE-WRITER'),
  `both invariants are named (${[...injectedRules].join(', ') || 'none'})`)
check(injected.json !== null && injected.json.stale.length === 0,
  'the fixture keeps the excepted code present, so nothing is stale there')

// C. A tree where the excepted code is gone: a stale exception is a finding of its own.
const bare = mkdtempSync(join(tmpdir(), 'boundaries-bare-'))
mkdirSync(join(bare, 'plugins'), { recursive: true })
const stale = run(['--check', '--json', '--root', bare], ROOT)
check(stale.status === 1, `a stale exception refuses the gate (exit ${stale.status})`)
check((stale.json?.stale ?? []).length > 0,
  `the stale exception is reported (${(stale.json?.stale ?? []).map((entry) => entry.id).join(', ') || 'none'})`)

if (failures > 0) {
  console.error(`boundaries acceptance: ${failures} check(s) failed`)
  process.exit(1)
}
console.log('boundaries acceptance: all checks passed')
