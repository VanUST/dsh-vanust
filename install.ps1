# dsh-kit installer -- Windows (fresh machine setup).
# What it does:
#   1. checks Node >= 24.9.0 (the pinned harness declares engines node >= 24.9.0),
#   2. installs the pinned harness version globally (npm i -g),
#   3. creates $env:DSH_HOME\profiles\web from the kit's canonical profile files,
#   4. installs every plugin tarball in plugins\ into the profile (see
#      plugins\inventory.json for the set),
#   5. installs the DEPLOYMENT.md procedure to $env:DSH_HOME,
#   6. installs optional external binaries (best effort), and
#   7. installs the convergence wrapper to $env:DSH_HOME\bin\dsh.ps1,
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
$DSH_VERSION = '0.2.2-rc.3'
$PNPM_VERSION = '11.7.0'
$DSH_HOME = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.npm\dsh' }

# 0. One guard for every MANDATORY external command.
#
#    Windows PowerShell does NOT turn a non-zero exit code of a native program into an error,
#    even under $ErrorActionPreference = 'Stop': only cmdlets and thrown exceptions are
#    terminating, so `npm install` / `corepack add` could fail and the script carried on to
#    print '== done ==' with exit code 0. The result was a profile without the harness or
#    without its plugins that was announced as installed. Every mandatory external command is
#    followed by Assert-Step, which names the step and stops the install with a non-zero code.
#    OPTIONAL steps do not use it: missing external tools are reported and never fail the
#    install.
function Assert-Step([string]$Step) {
  if ($LASTEXITCODE -ne 0) {
    $code = $LASTEXITCODE
    [Console]::Error.WriteLine("ERROR: step '$Step' failed with exit code $code -- the install stopped here and nothing after this step ran.")
    exit 1
  }
}

Write-Host "== dsh-kit installer (harness $DSH_VERSION) =="

# 1. Node check: >= 24.9.0, MAJOR AND MINOR.
#
#    The pinned harness declares engines node >= 24.9.0, so a major-only check let Node
#    24.0-24.8 through and it failed at the harness start - after the installer had
#    stopped explaining. A major above 24 is accepted whatever its minor.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Error 'Node.js not found -- install Node >= 24.9.0 first (https://nodejs.org).'; exit 1 }
$nodeVersion = (& node -p 'process.versions.node').Trim()
$nodeParts = $nodeVersion.Split('.')
$nodeMajor = 0
$nodeMinor = 0
if ($nodeParts.Length -lt 2 -or
    -not [int]::TryParse($nodeParts[0], [ref]$nodeMajor) -or
    -not [int]::TryParse($nodeParts[1], [ref]$nodeMinor)) {
  Write-Error "cannot read the Node version (expected 24.9.0 or newer, got '$nodeVersion')."
  exit 1
}
if ($nodeMajor -lt 24 -or ($nodeMajor -eq 24 -and $nodeMinor -lt 9)) {
  Write-Error "Node $nodeVersion detected -- dsh-kit requires Node >= 24.9.0 (the pinned harness declares engines node >= 24.9.0, so 24.0-24.8 stops at its first start)."
  exit 1
}
Write-Host "   node: $(& node -v) (ok, >= 24.9.0)"

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
  Assert-Step 'npm config set prefix'
}
Write-Host "   npm prefix: $npmPrefix (user-local, no admin needed)"
Write-Host "   installing @deepseek-ai/dsh@$DSH_VERSION (global)..."
npm install -g --no-audit --no-fund "@deepseek-ai/dsh@$DSH_VERSION"
Assert-Step 'npm install -g (pinned harness)'
$env:PATH = "$npmPrefix;$env:PATH"

# 3. Web profile from the canonical kit files.
#
#    A cordis.patch.yml that DIFFERS from the kit is the machine's own layer - the rows
#    somebody added here - so it is kept, and a timestamped copy is left beside it. The
#    unconditional -Force copy this step used to do was the one place the two platforms
#    disagreed in MEANING, not in syntax: Linux kept the file and warned, Windows
#    silently replaced the machine's rows with the kit's.
$profileDir = Join-Path $DSH_HOME 'profiles\web'
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
$patchSource = Join-Path $KIT_DIR 'profile\cordis.patch.yml'
$patchDestination = Join-Path $profileDir 'cordis.patch.yml'
$patchDiffers = (Test-Path $patchDestination) -and ((Get-FileHash $patchSource).Hash -ne (Get-FileHash $patchDestination).Hash)
if ($patchDiffers) {
  $patchBackup = "$patchDestination.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  Copy-Item $patchDestination $patchBackup -Force
  Write-Host "   WARN: existing cordis.patch.yml differs from the kit - keeping yours (copy saved at $patchBackup)."
} else {
  Copy-Item $patchSource $patchDestination -Force
}
Copy-Item (Join-Path $KIT_DIR 'profile\package.json') (Join-Path $profileDir 'package.json') -Force
Copy-Item (Join-Path $KIT_DIR 'profile\pnpm-workspace.yaml') (Join-Path $profileDir 'pnpm-workspace.yaml') -Force

# 4. Plugin tarballs.
Write-Host '   installing the kit plugins (see plugins\inventory.json)...'
Push-Location $profileDir
try {
  corepack pnpm@$PNPM_VERSION add (Get-ChildItem (Join-Path $KIT_DIR 'plugins\*.tgz') | ForEach-Object { $_.FullName })
  Assert-Step 'corepack pnpm add (kit plugins)'
} finally {
  Pop-Location
}

# 5. The operating procedure, installed so a machine without the kit checked out can still
#    read how it is set up, updated and verified. Convergence afterwards is
#    `scripts/kit-update.mjs --apply`.
Copy-Item (Join-Path $KIT_DIR 'rules\DEPLOYMENT.md') (Join-Path $DSH_HOME 'DEPLOYMENT.md') -Force

# 6. The external binaries the features use: RTK, Marp, Mermaid
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

# 7. The convergence wrapper: checks the kit before every launch, so a plain `dsh web`
#    is also the moment the machine catches up. This is the Windows counterpart of the
#    `$DSH_HOME/bin/dsh` wrapper install.sh writes.
#
#    The installed copy lives OUTSIDE the checkout, so the kit path is baked in here
#    (the source carries the @KIT_DIR@ placeholder). The copy is written as UTF-8 WITH a
#    BOM: Windows PowerShell 5.1 decodes a BOM-less file with the system ANSI code page,
#    which would mangle a non-ASCII path baked into it. The wrapper SOURCE stays ASCII
#    for the same reason this file does.
$binDir = Join-Path $DSH_HOME 'bin'
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$wrapperSource = Join-Path $KIT_DIR 'scripts\dsh-wrapper.ps1'
$wrapperDestination = Join-Path $binDir 'dsh.ps1'
$wrapperText = [IO.File]::ReadAllText($wrapperSource).Replace('@KIT_DIR@', $KIT_DIR)
[IO.File]::WriteAllText($wrapperDestination, $wrapperText, (New-Object System.Text.UTF8Encoding($true)))
Write-Host "   wrapper: $wrapperDestination (checks the kit before every dsh launch)"
$pathEntries = @($env:PATH -split ';')
if ($pathEntries -notcontains $binDir) {
  Write-Host "   PATH: add $binDir BEFORE the npm global directory (or call dsh.ps1 explicitly)"
}

Write-Host
Write-Host '== done =='
Write-Host "   DSH_HOME : $DSH_HOME"
Write-Host '   start    : dsh web --port 3080   (or .\start.ps1)'
Write-Host '   docs     : open USERGUIDE.md for first-run checks and per-machine config (openCommand).'
