#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove that the installer rule in `scripts/lib/installer-steps.mjs` is a measurement, not a
 *   comment: it must REFUSE the installer that was shipped before the fix, ACCEPT the fixed
 *   one, and falsify two hand-made broken files of its own - one whose guard prints a message
 *   but never exits, one whose guard sits far from the command.
 *
 *   Why this exists rather than "read the file": the defect it pins was invisible to reading.
 *   `$ErrorActionPreference = 'Stop'` looks like error handling and is not: the preference
 *   governs PowerShell errors, while a native program only writes to streams, so a failed
 *   `npm install` or `corepack add` printed `== done ==` with exit 0. Only `$LASTEXITCODE`
 *   plus `exit` stops it (about_Preference_Variables 5.1, about_Automatic_Variables).
 *
 * INPUTS
 *   --ps1 <path>   installer text to judge. Default: install.ps1 in this kit.
 *
 *   Red→green pair (the exit code IS the verdict):
 *     git show HEAD:install.ps1 > /tmp/head-install.ps1
 *     node scripts/installer-steps-proof.mjs --ps1 /tmp/head-install.ps1   # exit 1: refused
 *     node scripts/installer-steps-proof.mjs                               # exit 0: accepted
 *
 * OUTPUTS
 *   One `VERDICT` line for the judged file, then one PASS/FAIL line per negative control, then
 *   `n/m checks passed`. Exit 0 only when the file is ACCEPTED and every control passed; exit 1
 *   otherwise (the red run is therefore exit 1 with the unguarded steps named), 2 on a usage
 *   error. A failing line names what was observed rather than a stack trace.
 *
 * KEYWORDS
 *   installer, PowerShell, LASTEXITCODE, exit code, red-first proof, negative control
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A missing `--ps1` file is a FAILURE of the verdict, not a crash: the red run usually
 *     points at a temp file a previous step failed to write.
 *   - The negative controls are built here, so they exist regardless of what git holds; the
 *     git file is the "before" observation, these are the rule's own falsifiers.
 *   - The fixtures carry all three mandatory commands, so each is refused for the defect it is
 *     built with and not for a step it happens to omit.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GUARD_WINDOW, inspectInstallerSteps } from './lib/installer-steps.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const at = argv.indexOf('--ps1')
if (at >= 0 && at + 1 >= argv.length) {
  console.error('installer-steps-proof: --ps1 needs a path')
  process.exit(2)
}
const ps1Path = at >= 0 ? resolve(argv[at + 1]) : join(KIT, 'install.ps1')

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`)
}

let text = null
try {
  text = readFileSync(ps1Path, 'utf8')
} catch (error) {
  check('the installer file is readable', false, { path: ps1Path, error: String(error) })
}
let accepted = false
if (text !== null) {
  const inspected = inspectInstallerSteps(text)
  accepted = inspected.ok
  const guarded = inspected.mandatory.every((entry) => entry.guardLine !== null)
  process.stdout.write(
    `VERDICT  ${accepted ? 'accepted' : 'refused'}: ${ps1Path}\n` +
      `         ${inspected.mandatory.length} mandatory step(s); guarded=${guarded}; ${inspected.findings.length} finding(s)\n`,
  )
  for (const entry of inspected.mandatory) {
    process.stdout.write(`         step "${entry.step}" line ${entry.line} -> guard ${entry.guardLine ?? 'MISSING'}\n`)
  }
  for (const finding of inspected.findings) {
    process.stdout.write(`         ${finding.code}${finding.line === 0 ? '' : ` at line ${finding.line}`}: ${finding.message}\n`)
  }
}

// NEGATIVE CONTROLS: the rule must falsify files it was never shown in git.
const guardedHelper = [
  'function Assert-Step([string]$Step) {',
  '  if ($LASTEXITCODE -ne 0) {',
  '    [Console]::Error.WriteLine("ERROR: $Step failed")',
  '    exit 1',
  '  }',
  '}',
].join('\n')
const COMMANDS = [
  { line: 'npm config set prefix $npmPrefix | Out-Null', guard: 'Assert-Step "npm config set prefix"' },
  { line: 'npm install -g --no-audit --no-fund "@deepseek-ai/dsh@$DSH_VERSION"', guard: 'Assert-Step "npm install -g @deepseek-ai/dsh"' },
  { line: 'corepack pnpm@$PNPM_VERSION add (Get-ChildItem (Join-Path $KIT_DIR "plugins\\*.tgz")).FullName', guard: 'Assert-Step "corepack pnpm add"' },
]
const installerFixture = (helper, filler = []) => [
  helper,
  ...COMMANDS.flatMap((command, index) => (index === 0 ? [command.line, ...filler, command.guard] : [command.line, command.guard])),
].join('\n')

const printOnly = inspectInstallerSteps(
  installerFixture([
    'function Assert-Step([string]$Step) {',
    '  if ($LASTEXITCODE -ne 0) {',
    '    Write-Host "failed: $Step"',
    '  }',
    '}',
  ].join('\n')),
)
check(
  'a guard that prints but does not exit is refused',
  !printOnly.ok && printOnly.findings.some((finding) => finding.code === 'helper-does-not-exit'),
  printOnly.findings.map((finding) => finding.code),
)
const farGuard = inspectInstallerSteps(
  installerFixture(guardedHelper, Array.from({ length: GUARD_WINDOW + 2 }, (_, index) => `Write-Host "step ${index}"`)),
)
check(
  `a guard more than ${GUARD_WINDOW} code lines after the command does not count`,
  !farGuard.ok && farGuard.findings.some((finding) => finding.code === 'unguarded-command'),
  farGuard.findings.map((finding) => finding.code),
)
const wellFormed = inspectInstallerSteps(installerFixture(guardedHelper))
check(
  'a command, a guarded helper and the call are accepted',
  wellFormed.ok && wellFormed.mandatory.length === COMMANDS.length,
  { findings: wellFormed.findings.map((finding) => finding.code), mandatory: wellFormed.mandatory.length },
)

const failed = results.filter((result) => !result.ok).length
const ok = accepted && failed === 0
process.stdout.write(`\n${ok ? 'GREEN' : 'RED'}: ${results.length - failed}/${results.length} checks passed${accepted ? '' : ' — the installer was refused'}\n`)
process.exit(ok ? 0 : 1)
