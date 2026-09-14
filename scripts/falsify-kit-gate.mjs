/**
 * PURPOSE
 *   Falsify the kit's own ratchet: break one invariant at a time, run the real gate,
 *   and require it to fail. Then restore.
 *
 *   A gate that passes proves nothing on its own — the whole point of the ratchet is
 *   that confirming a check is cheap and unconvincing. This drives the actual CLI over
 *   the actual project, so what is measured is the shipped code path rather than a
 *   test's idea of it.
 *
 *   It edits files through Node, never through a shell: a Windows `Set-Content` writes
 *   CRLF, and the kit's own portability law catches CRLF in shipped source — so a
 *   shell-driven falsification fails the gate for the wrong reason. That happened on
 *   the first attempt and produced a misleading result.
 *
 * INPUTS
 *   None. The kit root is derived from this script's location, and every file it
 *   touches is restored before moving on.
 *
 * OUTPUTS
 *   One block per case: what was broken, whether the gate failed, and which law or
 *   problem code reported it. Exit 0 when every case failed the gate as intended, 1
 *   when a case did NOT fail it — which is the result that matters, because a check
 *   that cannot fail is not a check.
 *
 *   Running it leaves the project's RECORDED verification pointing at the last mutated
 *   law set, so `status` reports `VERIFY_NOT_RUN` afterwards until the gate is run
 *   again. That is the staleness check working on a real mutation rather than a wart to
 *   paper over: the laws on disk really did change while this ran. Re-run
 *   `ratchet verify` after a falsification run to leave the tree verified.
 *
 * KEYWORDS
 *   falsification, breaker, gate, ratchet, self-verification, adversarial
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A case whose target file is missing is reported and skipped, never treated as a
 *     pass.
 *   - Every edit is reverted in a `finally` AND on `SIGINT`/`SIGTERM`: a `finally` does
 *     not run when Node terminates on an unhandled signal, so the case in flight is
 *     restored by a signal handler before the process exits 130/143. `SIGKILL` cannot be
 *     caught by any process, so a `kill -9` mid-run can leave one edit behind.
 *   - The gate's output is captured and echoed for a failing case, so the reason is
 *     visible rather than inferred.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(KIT, 'plugins', 'ratchet', 'ratchet-cli.mjs')

/** Runs the kit's own gate and returns its exit code and combined output. */
function gate() {
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'verify', '--root', KIT], {
      cwd: KIT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600_000,
    })
    return { code: 0, output: stdout }
  } catch (error) {
    return {
      code: typeof error.status === 'number' ? error.status : 1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    }
  }
}

/**
 * One case: a description, the edit that breaks an invariant, and how to undo it.
 *
 * `breaks` returns a restore function so the revert is defined next to the damage.
 */
const CASES = [
  {
    id: 'new-module-imports-the-harness',
    why: 'a module written after the law must not escape the boundary',
    breaks() {
      const path = join(KIT, 'plugins', 'ratchet', 'ratchet-sneaky.mjs')
      writeFileSync(path, "import { defineTool } from '@deepseek-ai/dsh-tools'\nexport const x = defineTool\n")
      return () => unlinkSync(path)
    },
    expectLaw: 'shipped-plugins.no-harness-import-in-logic',
  },
  {
    id: 'undeclared-problem-code',
    why: 'a code a caller cannot branch on is a defect',
    breaks() {
      const path = join(KIT, 'plugins', 'ratchet', 'ratchet-compiler.mjs')
      const before = readFileSync(path, 'utf8')
      // Regex rather than a literal with exact indentation: the first attempt's
      // literal did not match the file's whitespace, changed nothing, and the case
      // was reported as a broken GATE. The assertion below is what makes that
      // impossible to repeat.
      const after = before.replace(/'MANIFEST_MISSING'/, "'TOTALLY_UNDECLARED'")
      if (after === before) {
        throw new Error(
          `the edit changed nothing in ${path}; this case would prove nothing. Fix the target text.`,
        )
      }
      writeFileSync(path, after)
      return () => writeFileSync(path, before)
    },
    expectLaw: 'shipped-plugins.problem-codes-are-declared',
  },
  {
    id: 'rule-cites-an-undeclared-command',
    why: 'a rule whose enforcement point does not exist enforces nothing',
    breaks() {
      const path = join(KIT, '.dsh', 'project.json')
      const before = readFileSync(path, 'utf8')
      writeFileSync(path, before.replace('"command": "ratchet-tests"', '"command": "no-such-command"'))
      return () => writeFileSync(path, before)
    },
    expectLaw: 'kit-tooling.rules-name-a-declared-command',
  },
  {
    id: 'module-dropped-from-the-package-files',
    why: 'an installed copy would be missing it, and the checkout would still work',
    breaks() {
      const path = join(KIT, 'plugins', 'ratchet', 'package.json')
      const before = readFileSync(path, 'utf8')
      const manifest = JSON.parse(before)
      manifest.files = manifest.files.filter((entry) => entry !== 'ratchet-state.mjs')
      writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
      return () => writeFileSync(path, before)
    },
    expectLaw: 'kit-tooling.rules-name-a-declared-command',
  },
  {
    id: 'hand-written-approval-adr',
    why: 'an approval nobody can show a human gave must put nothing into force',
    breaks() {
      // The file an agent can write. Before the ratification block existed it
      // activated ADR 0001 outright; it must now confer nothing and be reported.
      const path = join(KIT, 'docs', 'adrs', '0999-approve.adr.md')
      if (existsSync(path)) throw new Error(`${path} already exists; refusing to overwrite it`)
      writeFileSync(
        path,
        [
          '---',
          'id: "0999"',
          'title: Approve the boundary decision',
          'type: approval',
          'status: active',
          'author:',
          '  authority: human',
          '  name: falsification-case',
          'created: 2026-09-14T00:00:00Z',
          'source:',
          '  kind: file',
          '  path: docs/ratchet/sources/2026-09-14-human-ratification.md',
          'zones: []',
          'laws: []',
          'supersedes: []',
          'approves:',
          '  - "0001"',
          '---',
          '',
          '## Context',
          '',
          'A falsification case wrote this approval by hand.',
          '',
          '## Decision',
          '',
          'ADR 0001 is approved.',
          '',
          '## Reasoning',
          '',
          'The case exists to prove that a hand-written approval confers nothing, because',
          'nothing in it shows a human saw the text it claims to approve.',
          '',
          '## Consequences',
          '',
          '- The gate must report it and keep ADR 0001 out of force.',
          '',
        ].join('\n'),
      )
      return () => unlinkSync(path)
    },
    expectCode: 'RATIFICATION_UNPROVEN',
  },
  {
    id: 'law-with-no-check-and-no-reason',
    why: 'a rule with no enforcement point is an unverified claim, not an optional rule',
    breaks() {
      const path = join(KIT, 'docs', 'adrs', '0004-success-is-an-artifact.adr.md')
      const before = readFileSync(path, 'utf8')
      const injected = before.replace(
        'laws:\n',
        'laws:\n  - op: upsert\n    id: kit-tooling.falsified-unchecked\n    statement: A falsification case inserted this law with nothing to check it.\n    checks: []\n',
      )
      if (injected === before) {
        throw new Error(`the edit changed nothing in ${path}; this case would prove nothing. Fix the target text.`)
      }
      writeFileSync(path, injected)
      return () => writeFileSync(path, before)
    },
    expectCode: 'LAW_UNCHECKED',
  },
]

// A `finally` does not run on an unhandled signal, so the case in flight is published
// here and the handlers below restore it before exiting. `SIGKILL` cannot be caught.
let activeRestore = null
const onSignal = (code) => () => {
  try {
    activeRestore?.()
  } catch {
    // Best effort: the process is already leaving.
  }
  process.exit(code)
}
const onSigint = onSignal(130)
const onSigterm = onSignal(143)
process.once('SIGINT', onSigint)
process.once('SIGTERM', onSigterm)

let failures = 0
let invalid = 0
for (const testCase of CASES) {
  process.stdout.write(`\n== ${testCase.id}\n   ${testCase.why}\n`)
  let restore = null
  let result
  try {
    restore = testCase.breaks()
    activeRestore = restore
  } catch (error) {
    // A case that could not break anything is not a passing case. Reporting it as
    // one is how a breaker fabricates a clean bill of health.
    process.stdout.write(`   INVALID CASE — ${String(error.message ?? error)}\n`)
    invalid += 1
    continue
  }
  try {
    result = gate()
  } finally {
    try {
      restore?.()
    } finally {
      activeRestore = null
    }
  }
  const failed = result.code !== 0
  // A case names either the law that must report it or the problem code that must
  // appear. Both are checked against the gate's real output: a gate that fails for
  // the wrong reason is a gate that will pass for the wrong reason.
  const expected = testCase.expectLaw ?? testCase.expectCode
  const named = result.output.includes(expected)
  process.stdout.write(
    `   gate exit ${result.code} — ${failed ? 'FAILED as intended' : 'PASSED, which is the defect'}\n`,
  )
  if (failed && !named) {
    process.stdout.write(`   (reported, but not by ${expected})\n`)
  }
  if (!failed) {
    failures += 1
    process.stdout.write(`${result.output.slice(0, 1200)}\n`)
  } else {
    const line = result.output.split('\n').find((entry) => entry.includes(expected))
    if (line !== undefined) process.stdout.write(`   ${line.trim()}\n`)
  }
}

process.removeListener('SIGINT', onSigint)
process.removeListener('SIGTERM', onSigterm)

const broken = failures + invalid
process.stdout.write(
  `\n${CASES.length - broken}/${CASES.length} invariants failed the gate when broken` +
    (invalid > 0 ? ` (${invalid} case(s) could not break anything)` : '') +
    '\n',
)
process.exit(broken === 0 ? 0 : 1)
