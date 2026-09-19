# dsh-kit installer -- Windows (fresh machine setup).
# What it does:
#   1. checks Node >= 24 (node-pty ABI),
#   2. installs the pinned harness version globally (npm i -g),
#   3. creates $env:DSH_HOME\profiles\web from the kit's canonical profile files,
#   4. installs every plugin tarball in plugins\ into the profile (five plugins:
#      model-gate, dsh-context, kit-rules, ratchet, adr-panel -- see plugins\inventory.json),
#   5. installs the user-global core operating rules ($env:DSH_HOME\AGENTS.md) and the
#      DEPLOYMENT.md procedure they point at,
#   6. links the harness packages so the kit's own tests and gate run from this checkout.
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
$DSH_VERSION = '0.1.5-rc.1'
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
Write-Host '   installing the kit plugins (model-gate, dsh-context, kit-rules, ratchet)...'
Push-Location $profileDir
try {
  corepack pnpm@$PNPM_VERSION add (Get-ChildItem (Join-Path $KIT_DIR 'plugins\*.tgz') | ForEach-Object { $_.FullName })
} finally {
  Pop-Location
}

# 5. User-global core operating rules, plus the procedure they point at. Both are
#    installed together: the rules name $DSH_HOME/DEPLOYMENT.md as the setup/update
#    procedure an agent should follow, and a pointer to a missing file is worse than
#    no pointer at all.
Copy-Item (Join-Path $KIT_DIR 'rules\AGENTS.md') (Join-Path $DSH_HOME 'AGENTS.md') -Force
Copy-Item (Join-Path $KIT_DIR 'rules\DEPLOYMENT.md') (Join-Path $DSH_HOME 'DEPLOYMENT.md') -Force

# 6. Development links, so the kit's OWN gate runs from this checkout. The ratchet's tool
#    adapter imports `@deepseek-ai/dsh-tools`, which lives in the harness install and not
#    in this repository; the tests and probes resolve it through a link beside them. Not
#    fatal if it fails -- the DEPLOYMENT does not need the link, only the self-check does.
& node (Join-Path $KIT_DIR 'scripts\dev-link.mjs') | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Warning "could not link the harness packages; run 'node scripts\dev-link.mjs' in $KIT_DIR before using the kit's own gate."
}

Write-Host
Write-Host '== done =='
Write-Host "   DSH_HOME : $DSH_HOME"
Write-Host '   start    : dsh web --port 3080   (or .\start.ps1)'
Write-Host '   docs     : open USERGUIDE.md for first-run checks and per-machine config (openCommand).'
