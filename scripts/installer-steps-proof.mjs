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
const shAt = argv.indexOf('--sh')
if (shAt >= 0 && shAt + 1 >= argv.length) {
  console.error('installer-steps-proof: --sh needs a path')
  process.exit(2)
}
const ps1Path = at >= 0 ? resolve(argv[at + 1]) : join(KIT, 'install.ps1')
const shPath = shAt >= 0 ? resolve(argv[shAt + 1]) : join(KIT, 'install.sh')

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
let shellText = null
try {
  shellText = readFileSync(shPath, 'utf8')
} catch (error) {
  check('the shell installer is readable', false, { path: shPath, error: String(error) })
}

// The installer properties added with the rollback work. Each is a predicate plus a
// hand-made fixture that must be REFUSED, so a predicate that passes everything cannot
// look green: the fixture is the falsifier.
const nodeGateSh = (source) =>
  /NODE_MINOR=/.test(source) && /NODE_MINOR[^\n]*-lt 9/.test(source) && /NODE_MAJOR[^\n]*-lt 24/.test(source)
const nodeGatePs1 = (source) =>
  /\$nodeMinor/.test(source) && /\$nodeMinor -lt 9/.test(source) && /\$nodeMajor -lt 24/.test(source)
const patchPreserved = (source) =>
  /Get-FileHash \$patchSource/.test(source) &&
  /Copy-Item \$patchDestination \$patchBackup -Force/.test(source) &&
  /"\$patchDestination\.bak-/.test(source)
const WRAPPER = join(KIT, 'scripts', 'dsh-wrapper.ps1')
const wrapperInstalled = (source) =>
  /dsh-wrapper\.ps1/.test(source) && /Join-Path \$binDir 'dsh\.ps1'/.test(source) && /@KIT_DIR@/.test(source)
const wrapperConverges = (source) =>
  source.includes('@KIT_DIR@') && /--check/.test(source) && /--apply/.test(source) && /report\.server\.running/.test(source)
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
let acceptedSh = false
if (shellText !== null) {
  acceptedSh = nodeGateSh(shellText)
  process.stdout.write(
    `VERDICT  ${acceptedSh ? 'accepted' : 'refused'}: ${shPath}\n` +
      `         node gate: ${acceptedSh ? 'major and minor >= 24.9.0' : 'does not check the minor'}\n`,
  )
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

// ── the properties added with the rollback work ───────────────────────────────
// Each check is a predicate on the real installer plus a fixture it must REFUSE, so a
// predicate that answers true for anything cannot hide behind the real file.
check(
  'install.sh checks the Node MINOR, not only the major',
  shellText !== null && nodeGateSh(shellText),
  { path: shPath, found: shellText === null ? 'unreadable' : nodeGateSh(shellText) ? 'major and minor' : 'no minor comparison' },
)
check(
  'a major-only Node gate in install.sh is refused',
  !nodeGateSh([
    'NODE_MAJOR="$(node -p "Number(process.versions.node.split(\".\")[0])")"',
    'if [ "$NODE_MAJOR" -lt 24 ]; then exit 1; fi',
  ].join('\n')),
  { fixture: 'major-only shell gate' },
)
check(
  'install.ps1 checks the Node MINOR, not only the major',
  text !== null && nodeGatePs1(text),
  { path: ps1Path, found: text === null ? 'unreadable' : nodeGatePs1(text) ? 'major and minor' : 'no minor comparison' },
)
check(
  'a major-only Node gate in install.ps1 is refused',
  !nodeGatePs1([
    '$nodeMajor = [int]((& node -p "process.versions.node.split(\".\")[0]").Trim())',
    'if ($nodeMajor -lt 24) { Write-Error "Node too old"; exit 1 }',
  ].join('\n')),
  { fixture: 'major-only PowerShell gate' },
)
check(
  'install.ps1 keeps a differing cordis.patch.yml and saves a timestamped .bak',
  text !== null && patchPreserved(text),
  { path: ps1Path },
)
check(
  'an unconditional -Force copy of the profile patch is refused',
  !patchPreserved([
    "Copy-Item (Join-Path $KIT_DIR 'profile\\cordis.patch.yml') (Join-Path $profileDir 'cordis.patch.yml') -Force",
  ].join('\n')),
  { fixture: 'pre-fix overwrite' },
)
check(
  'install.ps1 installs the convergence wrapper to $DSH_HOME\\bin',
  text !== null && wrapperInstalled(text),
  { path: ps1Path },
)
check(
  'an installer with no wrapper step is refused',
  !wrapperInstalled('Write-Host "== done =="'),
  { fixture: 'installer without a wrapper' },
)
let wrapperText = null
try {
  wrapperText = readFileSync(WRAPPER, 'utf8')
} catch (error) {
  check('the Windows convergence wrapper is readable', false, { path: WRAPPER, error: String(error) })
}
if (wrapperText !== null) {
  check(
    'the Windows wrapper checks the kit and offers the update before booting',
    wrapperConverges(wrapperText),
    { path: WRAPPER },
  )
  check(
    'the Windows wrapper is ASCII, so PowerShell 5.1 cannot mis-decode it',
    !/[^\x00-\x7F]/.test(wrapperText),
    { firstOffender: wrapperText.match(/[^\x00-\x7F]/)?.[0] },
  )
  check(
    'a wrapper that boots without the check is refused',
    !wrapperConverges('& node $entry @args'),
    { fixture: 'wrapper without a check' },
  )
}

const failed = results.filter((result) => !result.ok).length
const ok = accepted && acceptedSh && failed === 0
process.stdout.write(
  `\n${ok ? 'GREEN' : 'RED'}: ${results.length - failed}/${results.length} checks passed` +
    `${accepted ? '' : ' — install.ps1 was refused'}${acceptedSh ? '' : ' — install.sh was refused'}\n`,
)
process.exit(ok ? 0 : 1)
