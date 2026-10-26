/**
 * PURPOSE
 *   Prove on THIS machine and THIS repository that the rtk output seam really
 *   shrinks what the model would otherwise read, rather than trusting the unit
 *   shape of `filterOutput`. The plugin's happy path needs a running harness; the
 *   mapping and the byte decision do not, so this script runs the same
 *   `classifyCommand` -> `filterOutput` path the listener uses over real command
 *   output and reports each case.
 *
 * INPUTS
 *   None. `rtk` is resolved the way the plugin resolves it: the configured
 *   absolute path, then PATH. Commands run with `bash -c` in the kit root.
 *
 * OUTPUTS
 *   One line per case with filter, command exit code, rtk exit code, before and
 *   after bytes, and the shrink/pass-through verdict. A final `verdict:` line
 *   followed by exit 0 only when every case matches its expectation; exit 1 on a
 *   failed case, 2 when rtk itself is not installed.
 *
 * PORTABILITY
 *   POSIX only: every case runs its command through `bash -c`, so this script cannot
 *   run on Windows even though the plugin supports pwsh. The plugin's exports
 *   (classifyCommand, filterOutput) are platform-neutral and are what a Windows
 *   check should exercise.
 *
 * KEYWORDS
 *   rtk, rtk pipe, output compression, selftest, byte savings, proof
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A command that exits non-zero is reported with its code; the case only
 *     passes when the expected pass-through/transform still happened, so a
 *     broken fixture cannot pass silently.
 *   - A fixture whose output falls below `minChars` fails a `shrink` case, because
 *     the filter then never ran and the run would prove nothing.
 *   - `git status` is in the table as a DELIBERATE pass-through: its filter trims
 *     one byte, so the banner would make the result larger and the net-loss guard
 *     keeps the original. It proves the guard, not the filter.
 *   - An unmapped command and a compound command are deliberate pass-throughs,
 *     proving the conservative classification alongside the saving cases.
 *   - If a spawn of the fixture command fails, the row reports it and the run
 *     fails; no exception escapes.
 */

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { classifyCommand, filterOutput, resolveRtk } from '../plugins/rtk/rtk.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIN_CHARS = 1500
const MAX_BUFFER = 64 * 1024 * 1024

/**
 * Real commands, each with the filter the classifier must choose and the outcome
 * the seam must reach. `shrink` requires the transform to apply and reduce bytes;
 * `passthrough` requires it not to touch the text.
 */
const CASES = [
  {
    command: 'git log --oneline -100',
    filter: 'git-log',
    expect: 'shrink',
  },
  {
    command: 'git log -p -1 -- plugins/proof-guard',
    filter: 'git-log',
    expect: 'shrink',
  },
  {
    command: 'rg -n "export function" plugins',
    filter: 'rg',
    expect: 'shrink',
  },
  {
    command: 'grep -rn "export function" plugins --include=*.mjs',
    filter: 'grep',
    expect: 'shrink',
  },
  {
    command: 'find . -path ./.git -prune -o -type f -print',
    filter: 'find',
    expect: 'shrink',
  },
  {
    // THE REAL SHAPE: the harness prefixes every shell call with `cd <cwd> &&`.
    // Every earlier case ran a pristine command, which is exactly how the plugin
    // shipped with a classifier that refused 100% of real agent calls.
    command: `cd ${KIT} && git log --oneline -40`,
    filter: 'git-log',
    expect: 'shrink',
  },
  {
    // The filter only trims the trailing newline, so banner + text would be larger:
    // the net-loss guard must keep the original and SAY SO. On a clean worktree the
    // output is under minChars, so this case also accepts the below-min guard —
    // both are honest pass-throughs, and any other reason fails the case.
    command: 'git status --short',
    filter: 'git-status',
    expect: 'passthrough',
    expectReason: ['not-smaller', 'below-min-chars'],
  },
  {
    // A compound command must never be classified.
    command: 'git log --oneline | head -3',
    filter: null,
    expect: 'passthrough',
  },
  {
    // Unmapped command: no rule, so no filter.
    command: 'ls -la plugins/proof-guard',
    filter: null,
    expect: 'passthrough',
  },
]

/** Pad a cell to a fixed width without throwing on long values. */
function cell(value, width) {
  const text = String(value)
  return text.length >= width ? text : `${text}${' '.repeat(width - text.length)}`
}

const rtk = resolveRtk({})
if (rtk === null) {
  process.stderr.write('rtk-selftest: rtk not found at the configured path or on PATH\n')
  process.exit(2)
}

process.stdout.write(`rtk-selftest: bin ${rtk.bin} (${rtk.version ?? 'version unknown'}), minChars ${MIN_CHARS}\n`)
process.stdout.write(
  `${cell('#', 3)}${cell('filter', 14)}${cell('before', 8)}${cell('after', 8)}${cell('cmd-exit', 10)}${cell('rtk-exit', 10)}${cell('verdict', 13)}${cell('reason', 18)}command\n`,
)

let saved = 0
let failures = 0
let shrank = 0
let passed = 0

for (const [index, item] of CASES.entries()) {
  const run = spawnSync('bash', ['-c', item.command], {
    cwd: KIT,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  })
  const stdout = typeof run.stdout === 'string' ? run.stdout : ''
  const commandExit = run.status === null ? `signal:${run.signal ?? '?'}` : run.status
  const classified = classifyCommand(item.command)
  const outcome = await filterOutput(item.command, stdout, { bin: rtk.bin, minChars: MIN_CHARS })

  const mapped = classified === item.filter
  // A pass-through must state WHY it passed. `!outcome.applied` alone accepted an
  // unclassified command, an empty stdin and a genuine net-loss as the same result,
  // so a case could "prove" the net-loss guard without ever triggering it.
  const outcomeHolds = item.expect === 'shrink'
    ? classified !== null && outcome.applied && outcome.afterBytes < outcome.beforeBytes
    : !outcome.applied && typeof outcome.reason === 'string' && outcome.reason !== ''
       && (Array.isArray(item.expectReason) ? item.expectReason.includes(outcome.reason) : true)
  const ok = mapped && outcomeHolds && (item.expect !== 'shrink' || stdout.length >= MIN_CHARS)
  if (ok) {
    if (outcome.applied) {
      shrank += 1
      saved += outcome.beforeBytes - outcome.afterBytes
    } else {
      passed += 1
    }
  } else {
    failures += 1
  }

  const verdict = ok ? (outcome.applied ? 'shrunk' : 'passed') : 'FAILED'
  process.stdout.write(
    `${cell(`${index + 1}.`, 3)}${cell(outcome.filter ?? '-', 14)}${cell(outcome.beforeBytes, 8)}${cell(outcome.afterBytes, 8)}${cell(commandExit, 10)}${cell(outcome.exitCode ?? '-', 10)}${cell(verdict, 13)}${cell(outcome.reason ?? '-', 18)}${item.command}\n`,
  )
}

process.stdout.write(
  `verdict: ${failures === 0 ? 'PASS' : 'FAIL'} — ${shrank} shrank, ${passed} passed through, ${failures} failed, ${saved} B net saved (banner included)\n`,
)
process.exit(failures === 0 ? 0 : 1)
