/**
 * PURPOSE
 *   Prove that `proof/proof.mjs` can fail: run it against the PRE-FIX module and require a
 *   non-zero exit with the recovery rows red. A proof that only ever passed proves nothing.
 *
 *   The pre-fix module is taken from git, never from the working tree: at 0.1.2 `read` had no
 *   floor of its own and a read of a spill file was projected a second time, so the recovery
 *   rows must fail there. The script refuses a ref that already carries the fix
 *   (`isSpillRead`) or is byte-identical to the working module, because such a ref would turn
 *   the control into a second green run.
 *
 * INPUTS
 *   --ref <rev>   git revision to take the module from. Default `HEAD`; after the fix is
 *                 committed pass the commit before it (e.g. `--ref HEAD~1`).
 *
 * OUTPUTS
 *   The failing rows echoed, then `negative control: PASS|FAIL …`. Exit 0 when the pre-fix
 *   module was caught, 1 when the proof passed on it, 2 on a usage, ref or git error. The
 *   temporary copy lives under `proof/.negative-control-<pid>` — inside the kit, so Node
 *   resolves the kit's `node_modules` for `@deepseek-ai/dsh-output-retention` — and is removed
 *   before exit.
 *
 * KEYWORDS
 *   run-code-projection, negative control, red-first, proof, spill, read, tools/post-execute
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pluginDir = dirname(here)
const kitRoot = dirname(dirname(pluginDir))

/** Rows that must be red on the pre-fix module: the recovery path and the read floor. */
const REQUIRED_RED = [
  "read of the banner's file — full text returned, not projected again",
  'read of the banner file by its relative path — full text, not projected',
  'read of a spill above the read floor (217,600 bytes) — full text, not projected',
  'ordinary document (12,000 bytes, under the read floor) — read whole',
]

const refAt = process.argv.indexOf('--ref')
const ref = refAt === -1 ? 'HEAD' : process.argv[refAt + 1]
if (typeof ref !== 'string' || ref === '') {
  console.error('usage: node proof/negative-control.mjs [--ref <git revision>]')
  process.exit(2)
}

/** Run a command, returning its stdout and exit status without throwing. */
function run(file, args) {
  const result = spawnSync(file, args, { cwd: kitRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.error !== undefined && result.error !== null) throw result.error
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const relative = 'plugins/run-code-projection/run-code-projection.mjs'
const oldSource = run('git', ['show', `${ref}:${relative}`])
if (oldSource.status !== 0) {
  console.error(`negative control: git show ${ref}:${relative} failed: ${oldSource.stderr.trim()}`)
  process.exit(2)
}
const fixedSource = readFileSync(join(pluginDir, 'run-code-projection.mjs'), 'utf8')
if (oldSource.stdout.includes('isSpillRead')) {
  console.error(`negative control: ${ref} already carries the fix (isSpillRead); pass --ref <pre-fix commit>`)
  process.exit(2)
}
if (oldSource.stdout === fixedSource) {
  console.error(`negative control: ${ref} is byte-identical to the working module; nothing to be red about`)
  process.exit(2)
}

const scratch = join(here, `.negative-control-${process.pid}`)
try {
  mkdirSync(join(scratch, 'proof'), { recursive: true })
  writeFileSync(join(scratch, 'run-code-projection.mjs'), oldSource.stdout)
  copyFileSync(join(here, 'proof.mjs'), join(scratch, 'proof', 'proof.mjs'))
  copyFileSync(join(here, 'fixture-run-code.json'), join(scratch, 'proof', 'fixture-run-code.json'))
  const commit = run('git', ['rev-parse', '--short', ref]).stdout.trim()
  const proof = run(process.execPath, [join(scratch, 'proof', 'proof.mjs')])
  const rows = proof.stdout
    .split('\n')
    .filter((line) => /\sPASS\s|\sFAIL\s/.test(line) && !line.startsWith('run-code-projection proof:'))
  const red = rows.filter((line) => /\sFAIL\s/.test(line))
  const summary = proof.stdout.split('\n').find((line) => line.startsWith('run-code-projection proof:')) ?? 'no summary line'
  console.log(`pre-fix module from ${ref} (${commit || 'unknown commit'}), ${oldSource.stdout.length} bytes`)
  console.log(`${summary} → exit ${proof.status}; ${red.length} red row(s) of ${rows.length}`)
  for (const line of red) console.log(`  FAIL ${line.split(/\s{2,}/)[0].trim()}`)
  if (rows.length === 0) {
    console.log('the pre-fix module did not even print a table; its stderr:')
    for (const line of proof.stderr.trim().split('\n').slice(0, 6)) console.log(`  ${line}`)
  }
  const missing = REQUIRED_RED.filter((scenario) => !red.some((line) => line.startsWith(scenario)))
  if (proof.status !== 0 && missing.length === 0) {
    console.log('negative control: PASS — the pre-fix module is caught by the recovery rows')
    process.exitCode = 0
  } else {
    console.log(`negative control: FAIL — exit ${proof.status}, missing red row(s): ${missing.join(' | ') || 'none'}`)
    process.exitCode = 1
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
