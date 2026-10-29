# dsh-kit installer -- Windows (fresh machine setup).
# What it does:
#   1. checks Node >= 24 (node-pty ABI),
#   2. installs the pinned harness version globally (npm i -g),
#   3. creates $env:DSH_HOME\profiles\web from the kit's canonical profile files,
#   4. installs every plugin tarball in plugins\ into the profile (see
#      plugins\inventory.json for the set),
#   5. installs the DEPLOYMENT.md procedure to $env:DSH_HOME,
#
# Usage (PowerShell):
#   git clone <your-remote>/dsh-kit.git; cd dsh-kit
#   powershell -ExecutionPolicy Bypass -File install.ps1
#   dsh web --port 3080
#
# After install: configure API credentials (first GUI run), set the system
# file-manager command (see USERGUIDE.md), and run the first-run checks.
$ErrorActionPreference = 'Stop'

$KIT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$DSH_VERSION = '0.2.1-rc.2'
$PNPM_VERSION = '11.7.0'
$DSH_HOME = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.npm\dsh' }

Write-Host "== dsh-kit installer (harness $DSH_VERSION) =="

# 1. Node check.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Error 'Node.js not found -- install Node >= 24 first (https://nodejs.org).'; exit 1 }
$nodeMajor = [int]((& node -p 'process.versions.node.split(".")[0]').Trim())
if ($nodeMajor -lt 24) { Write-Error "Node $nodeMajor detected -- dsh-kit requires Node >= 24."; exit 1 }
Write-Host "   node: $(& node -v) (ok)"

# 2. Pinned harness install (user-local prefix, no admin needed). Keep an
#    existing user-local prefix; only switch a system-wide one.
#
#    This file is deliberately ASCII ONLY, and that is not a style preference: a
#    `.ps1` with no byte-order mark is decoded by Windows PowerShell 5.1 with the
#    system ANSI codepage, so a UTF-8 em dash (E2 80 94) is read as three ANSI
#    characters whose third byte is 0x94 -- a SMART DOUBLE QUOTE, which PowerShell
#    accepts as a string terminator. Measured on the committed file: an em dash inside
#    the double-quoted Write-Error below made `powershell -File install.ps1` fail with
#    `TerminatorExpectedAtEndOfString` / `MissingEndCurlyBrace` before running a single
#    line, while the same bytes with a UTF-8 BOM parsed with 0 errors. Keep this file
#    ASCII, or the installer stops being a script at all.
#
#    The comparison is case-insensitive AND directory-boundary aware. Both properties
#    were measured under Windows PowerShell 5.1, not assumed, because the obvious form is
#    wrong in two ways:
#      'C:\Users\1\AppData\Roaming\npm'.StartsWith('c:\users\1')   ->  False
#        StartsWith(string) is a culture-sensitive, CASE-SENSITIVE comparison, so a
#        user-local prefix written with any other casing reads as system-wide and the
#        else branch rewrites npm's global prefix on a machine that was already correct.
#      'C:\Users\1by\.npm'.StartsWith('C:\Users\1')                ->  True
#        There is no directory boundary, so a SIBLING whose name merely begins with the
#        profile string reads as user-local, is kept, and is announced as user-local.
#    The profile is trimmed of a trailing separator and the separator is appended
#    explicitly, so only the profile directory itself or a real descendant matches.
$currentPrefix = (& npm config get prefix).Trim()
$userProfile = if ($env:USERPROFILE) { $env:USERPROFILE.TrimEnd('\') } else { '' }
$prefixPath = $currentPrefix.TrimEnd('\')
$underProfile =
  $userProfile.Length -gt 0 -and (
    $prefixPath.Equals($userProfile, [System.StringComparison]::OrdinalIgnoreCase) -or
    $prefixPath.StartsWith($userProfile + '\', [System.StringComparison]::OrdinalIgnoreCase)
  )
if ($underProfile) {
  $npmPrefix = $currentPrefix
} else {
  $npmPrefix = if ($env:NPM_PREFIX) { $env:NPM_PREFIX } else { Join-Path $env:USERPROFILE '.npm' }
  npm config set prefix $npmPrefix | Out-Null
}
Write-Host "   npm prefix: $npmPrefix (user-local, no admin needed)"
Write-Host "   installing @deepseek-ai/dsh@$DSH_VERSION (global)..."
npm install -g --no-audit --no-fund "@deepseek-ai/dsh@$DSH_VERSION"
$env:PATH = "$npmPrefix;$env:PATH"

# 3. Web profile from the canonical kit files.
$profileDir = Join-Path $DSH_HOME 'profiles\web'
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
Copy-Item (Join-Path $KIT_DIR 'profile\cordis.patch.yml') (Join-Path $profileDir 'cordis.patch.yml') -Force
Copy-Item (Join-Path $KIT_DIR 'profile\package.json') (Join-Path $profileDir 'package.json') -Force
Copy-Item (Join-Path $KIT_DIR 'profile\pnpm-workspace.yaml') (Join-Path $profileDir 'pnpm-workspace.yaml') -Force

# 4. Plugin tarballs.
Write-Host '   installing the kit plugins (see plugins\inventory.json)...'
Push-Location $profileDir
try {
  corepack pnpm@$PNPM_VERSION add (Get-ChildItem (Join-Path $KIT_DIR 'plugins\*.tgz') | ForEach-Object { $_.FullName })
} finally {
  Pop-Location
}

# 5. The operating procedure, installed so a machine without the kit checked out can still
#    read how it is set up, updated and verified. Convergence afterwards is
#    `scripts/kit-update.mjs --apply`.
Copy-Item (Join-Path $KIT_DIR 'rules\DEPLOYMENT.md') (Join-Path $DSH_HOME 'DEPLOYMENT.md') -Force

# 6. The external binaries the features use: RTK, Headroom, Babysitter, Marp, Mermaid
#    CLI, D2. They are OPTIONAL by design - every feature degrades and says so - which
#    is exactly why a fresh machine silently lacks them for weeks. Best effort: a
#    failure here names the manual command and never fails the install.
#
#    Windows parity with install.sh: the POSIX-only installers are refused inside the
#    script (it reports the winget/choco equivalent per tool instead of half-installing),
#    so this step never runs a POSIX installer here. Without this block a Windows machine
#    was the only platform whose installer said nothing at all about the missing tools.
if ($env:SKIP_TOOLS -ne '1' -and (Test-Path (Join-Path $KIT_DIR 'scripts\provision-tools.mjs'))) {
  Write-Host
  Write-Host '== external tools (set SKIP_TOOLS=1 to skip) =='
  & node (Join-Path $KIT_DIR 'scripts\provision-tools.mjs') --apply --kit $KIT_DIR
  if ($LASTEXITCODE -ne 0) {
    Write-Host '   some tools are still missing; the features that need them degrade and say so'
  }
}

Write-Host
Write-Host '== done =='
Write-Host "   DSH_HOME : $DSH_HOME"
Write-Host '   start    : dsh web --port 3080   (or .\start.ps1)'
Write-Host '   docs     : open USERGUIDE.md for first-run checks and per-machine config (openCommand).'
