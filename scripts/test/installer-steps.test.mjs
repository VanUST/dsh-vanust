/*
PROOF: install.ps1 stops on a failed MANDATORY step instead of printing success.
Behavior: every mandatory external command in install.ps1 (npm config set prefix,
  npm install -g, corepack pnpm add) is followed by the Assert-Step guard, whose body reads
  $LASTEXITCODE and exits non-zero; the rule refuses a guard that only prints and a guard
  placed outside its window, so a renamed or removed guard fails this test.
Fails when: a mandatory command loses its guard, the guard stops exiting, or the guard moves
  away from the command it protects. `$ErrorActionPreference = 'Stop'` is NOT such a guard:
  PowerShell applies it to errors, while a native program only writes to streams, so the
  exit code must be read explicitly.
Production path: install.ps1 (Assert-Step and its three call sites), judged by
  scripts/lib/installer-steps.mjs; scripts/check-portability.mjs runs the same rule in
  `make verify`, so this test and the gate cannot drift apart.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GUARD_WINDOW, inspectInstallerSteps } from '../../scripts/lib/installer-steps.mjs'

const INSTALLER = readFileSync(join(process.cwd(), 'install.ps1'), 'utf8')
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''

test('negative control expect-pre-fix keeps the pre-fix installer shape', () => {
  if (control !== 'expect-pre-fix') return
  // The pre-fix shape: no guard at all after npm install -g / corepack add. This assertion
  // must fail on the fixed installer - that is the red.
  assert.equal(INSTALLER.includes('Assert-Step'), false)
})

test('every mandatory step of install.ps1 is followed by the exit-code guard', () => {
  const inspected = inspectInstallerSteps(INSTALLER)
  assert.deepEqual(inspected.findings, [])
  assert.equal(inspected.mandatory.length, 3)
  for (const entry of inspected.mandatory) {
    assert.ok(entry.guardLine !== null, `"${entry.step}" at line ${entry.line} has no Assert-Step guard`)
    assert.ok(entry.guardLine > entry.line, `"${entry.step}" guard must come after the command`)
  }
})

test('the guard reads $LASTEXITCODE and exits non-zero', () => {
  assert.match(INSTALLER, /\$LASTEXITCODE\s+-ne\s+0/)
  assert.match(INSTALLER, /exit 1/)
})

const COMMANDS = [
  { line: 'npm config set prefix $npmPrefix | Out-Null', guard: 'Assert-Step "npm config set prefix"' },
  { line: 'npm install -g --no-audit --no-fund "@deepseek-ai/dsh@$DSH_VERSION"', guard: 'Assert-Step "npm install -g"' },
  { line: 'corepack pnpm@$PNPM_VERSION add (Get-ChildItem (Join-Path $KIT_DIR "plugins\\*.tgz")).FullName', guard: 'Assert-Step "corepack pnpm add"' },
]
const fixture = (helper, filler = []) => [
  helper,
  ...COMMANDS.flatMap((command, index) => (index === 0 ? [command.line, ...filler, command.guard] : [command.line, command.guard])),
].join('\n')

test('a guard that prints but does not exit is refused', () => {
  const inspected = inspectInstallerSteps(fixture([
    'function Assert-Step([string]$Step) {',
    '  if ($LASTEXITCODE -ne 0) {',
    '    Write-Host "failed: $Step"',
    '  }',
    '}',
  ].join('\n')))
  assert.equal(inspected.ok, false)
  assert.ok(inspected.findings.some((finding) => finding.code === 'helper-does-not-exit'))
})

test(`a guard more than ${GUARD_WINDOW} code lines after the command is refused`, () => {
  const inspected = inspectInstallerSteps(fixture(
    ['function Assert-Step([string]$Step) {', '  if ($LASTEXITCODE -ne 0) {', '    exit 1', '  }', '}'].join('\n'),
    Array.from({ length: GUARD_WINDOW + 2 }, (_, index) => `Write-Host "step ${index}"`),
  ))
  assert.equal(inspected.ok, false)
  assert.ok(inspected.findings.some((finding) => finding.code === 'unguarded-command'))
})
