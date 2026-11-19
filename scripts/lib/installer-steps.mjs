/**
 * PURPOSE
 *   Decide, from the TEXT of `install.ps1`, whether every MANDATORY external command is
 *   followed by a check of its exit code. Windows PowerShell does not turn a non-zero exit
 *   code of a native program into an error: `$ErrorActionPreference` "determines how
 *   PowerShell responds to a non-terminating error" and native commands merely write to
 *   streams (about_Preference_Variables, PowerShell 5.1), so `Set-StrictMode`-style hopes do
 *   not stop a script. A failed `npm install` or `corepack add` therefore reached the success
 *   banner and announced a profile that was never built. Only an explicit `$LASTEXITCODE`
 *   check plus `exit` stops it (about_Automatic_Variables: "Contains the exit code of the last
 *   native program or PowerShell script that ran").
 *
 *   ONE RULE, TWO CALLERS. The kit gate (`scripts/check-portability.mjs`) runs it on the
 *   committed installer, so the guard cannot be dropped later. The proof
 *   (`scripts/installer-steps-proof.mjs`) runs the same rule on the pre-fix file taken from
 *   git, which is what shows the rule can fail instead of being a comment about a comment.
 *
 * INPUTS
 *   `inspectInstallerSteps(text)` - the whole text of a `.ps1` file.
 *
 * OUTPUTS
 *   `{ ok, mandatory, findings }`:
 *     mandatory - one row per mandatory command found: `{ step, line, guardLine }`, where
 *                 `guardLine` is the line of the `Assert-Step` call that follows it, or
 *                 `null` when none follows within `GUARD_WINDOW` code lines;
 *     findings  - `{ code, line, message }`. Codes: `no-helper` (the file defines no guard
 *                 function), `helper-does-not-exit` (the guard checks no `$LASTEXITCODE` or
 *                 has no `exit N`), `missing-command` (a mandatory step is gone from the
 *                 file), `unguarded-command` (a mandatory step is not followed by the guard).
 *
 * KEYWORDS
 *   installer, PowerShell, LASTEXITCODE, exit code, mandatory step, Assert-Step, guard
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Comment lines and blank lines are NOT code. The installer documents the failure it
 *     prevents, and a rule that counted the explanation as the command (or as the guard)
 *     would pass a broken file.
 *   - A mandatory command that is absent is a FINDING, not a silent pass: deleting the pinned
 *     harness install would otherwise satisfy "every command in the file is guarded".
 *   - The helper must both read `$LASTEXITCODE` and `exit` with a non-zero code. A helper that
 *     prints a message and returns would leave the install running into the success banner.
 *   - The window is counted in code lines, not raw lines, so an explanatory comment between a
 *     command and its guard does not read as a missing guard.
 */

/** Commands the install cannot do without. Optional steps (external tools) are never listed. */
export const MANDATORY_STEPS = [
  { step: 'npm config set prefix', pattern: /^\s*npm\s+config\s+set\s+prefix\b/ },
  { step: 'npm install -g @deepseek-ai/dsh', pattern: /^\s*npm\s+install\s+-g\b/ },
  { step: 'corepack pnpm add (kit plugins)', pattern: /^\s*corepack\s+pnpm@\S+\s+add\b/ },
]

/** How many code lines after a command may hold its guard. */
export const GUARD_WINDOW = 3

const HELPER = /^function\s+Assert-Step\b/

/**
 * @param {string} text - the whole text of a `.ps1` file.
 * @returns {{ok: boolean, mandatory: {step: string, line: number, guardLine: number|null}[], findings: {code: string, line: number, message: string}[]}}
 */
export function inspectInstallerSteps(text) {
  const findings = []
  const codeLines = String(text ?? '')
    .split('\n')
    .map((line, index) => ({ number: index + 1, code: line.trim() }))
    .filter((entry) => entry.code !== '' && !entry.code.startsWith('#'))
  const helperAt = codeLines.findIndex((entry) => HELPER.test(entry.code))
  if (helperAt < 0) {
    findings.push({
      code: 'no-helper',
      line: 0,
      message: 'install.ps1 defines no Assert-Step guard: a native command\'s non-zero exit code is not an error in Windows PowerShell, so it needs an explicit check',
    })
  } else {
    const body = []
    for (let index = helperAt + 1; index < codeLines.length; index += 1) {
      if (codeLines[index].code === '}') break
      body.push(codeLines[index])
    }
    const checksExitCode = body.some((entry) => entry.code.includes('$LASTEXITCODE'))
    const exits = body.some((entry) => /^exit\s+[1-9]\d*$/.test(entry.code))
    if (!checksExitCode || !exits) {
      findings.push({
        code: 'helper-does-not-exit',
        line: codeLines[helperAt].number,
        message: `the Assert-Step guard does not stop the install: checksExitCode=${checksExitCode} exits=${exits} (it must read $LASTEXITCODE and exit with a non-zero code)`,
      })
    }
  }
  const mandatory = []
  for (const spec of MANDATORY_STEPS) {
    const matches = codeLines.filter((entry) => spec.pattern.test(entry.code))
    if (matches.length === 0) {
      findings.push({
        code: 'missing-command',
        line: 0,
        message: `install.ps1 no longer contains the mandatory step "${spec.step}"; either it moved and this rule must follow it, or the install lost a step it cannot do without`,
      })
      continue
    }
    for (const match of matches) {
      const at = codeLines.indexOf(match)
      const guard = codeLines
        .slice(at + 1, at + 1 + GUARD_WINDOW)
        .find((entry) => /\bAssert-Step\b/.test(entry.code))
      mandatory.push({ step: spec.step, line: match.number, guardLine: guard === undefined ? null : guard.number })
      if (guard === undefined) {
        findings.push({
          code: 'unguarded-command',
          line: match.number,
          message: `"${spec.step}" at line ${match.number} has no Assert-Step guard: its non-zero exit code would print "== done ==" and exit 0`,
        })
      }
    }
  }
  return { ok: findings.length === 0, mandatory, findings }
}
