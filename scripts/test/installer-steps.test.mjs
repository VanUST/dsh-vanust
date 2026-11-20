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
const SHELL_INSTALLER = readFileSync(join(process.cwd(), 'install.sh'), 'utf8')
const WRAPPER = readFileSync(join(process.cwd(), 'scripts', 'dsh-wrapper.ps1'), 'utf8')
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

// The rest of the installer contract: the Node gate is >= 24.9.0 (major AND minor), the
// Windows installer keeps the machine's own profile layer instead of overwriting it, and
// it installs the convergence wrapper. Each assertion also names the pre-fix shape it
// rejects, so the test cannot pass on a comment that merely mentions the property.

const nodeGateSh = (source) =>
  /NODE_MINOR=/.test(source) && /NODE_MINOR[^\n]*-lt 9/.test(source) && /NODE_MAJOR[^\n]*-lt 24/.test(source)
const nodeGatePs1 = (source) =>
  /\$nodeMinor/.test(source) && /\$nodeMinor -lt 9/.test(source) && /\$nodeMajor -lt 24/.test(source)

test('install.sh gates Node on the minor version, not only the major', () => {
  assert.ok(nodeGateSh(SHELL_INSTALLER), 'install.sh must compare the Node minor against 9')
  assert.equal(nodeGateSh('NODE_MAJOR="$(node -p x)"\nif [ "$NODE_MAJOR" -lt 24 ]; then exit 1; fi'), false)
})

test('install.ps1 gates Node on the minor version, not only the major', () => {
  assert.ok(nodeGatePs1(INSTALLER), 'install.ps1 must compare the Node minor against 9')
  assert.equal(nodeGatePs1('$nodeMajor = [int]((& node -p x).Trim())\nif ($nodeMajor -lt 24) { exit 1 }'), false)
})

test('install.ps1 keeps a differing cordis.patch.yml and saves a timestamped copy', () => {
  assert.match(INSTALLER, /Get-FileHash \$patchSource/)
  assert.match(INSTALLER, /Copy-Item \$patchDestination \$patchBackup -Force/)
  assert.match(INSTALLER, /"\$patchDestination\.bak-/)
  // The pre-fix shape: one unconditional -Force copy, no comparison and no backup.
  assert.equal(
    /Copy-Item \(Join-Path \$KIT_DIR 'profile\\cordis\.patch\.yml'\) \(Join-Path \$profileDir 'cordis\.patch\.yml'\) -Force/.test(INSTALLER),
    false,
  )
})

test('install.ps1 installs the Windows convergence wrapper into $DSH_HOME\\bin', () => {
  assert.match(INSTALLER, /dsh-wrapper\.ps1/)
  assert.match(INSTALLER, /Join-Path \$binDir 'dsh\.ps1'/)
  assert.match(INSTALLER, /@KIT_DIR@/)
})

test('the Windows wrapper checks the kit and offers the update before booting', () => {
  assert.match(WRAPPER, /@KIT_DIR@/)
  assert.match(WRAPPER, /--check/)
  assert.match(WRAPPER, /--apply/)
  assert.match(WRAPPER, /report\.server\.running/)
  assert.equal(/[^\x00-\x7F]/.test(WRAPPER), false, 'a BOM-less .ps1 is decoded with the ANSI codepage; keep it ASCII')
})
