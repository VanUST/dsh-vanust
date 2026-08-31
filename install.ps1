# dsh-kit installer — Windows (fresh machine setup).
# What it does:
#   1. checks Node >= 24 (node-pty ABI),
#   2. installs the pinned harness version globally (npm i -g),
#   3. creates $env:DSH_HOME\profiles\web from the kit's canonical profile files,
#   4. installs the workbench plugin tarballs into the profile,
#   5. installs the user-global core operating rules ($env:DSH_HOME\AGENTS.md).
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
$DSH_VERSION = '0.1.1-rc.2'
$PNPM_VERSION = '11.7.0'
$DSH_HOME = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.npm\dsh' }

Write-Host "== dsh-kit installer (harness $DSH_VERSION) =="

# 1. Node check.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Error 'Node.js not found — install Node >= 24 first (https://nodejs.org).'; exit 1 }
$nodeMajor = [int]((& node -p 'process.versions.node.split(".")[0]').Trim())
if ($nodeMajor -lt 24) { Write-Error "Node $nodeMajor detected — dsh-kit requires Node >= 24."; exit 1 }
Write-Host "   node: $(& node -v) (ok)"

# 2. Pinned harness install (user-local prefix — no admin needed). Keep an
#    existing user-local prefix; only switch a system-wide one.
$currentPrefix = (& npm config get prefix).Trim()
if ($currentPrefix.StartsWith($env:USERPROFILE)) {
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
Write-Host '   installing workbench plugins...'
Push-Location $profileDir
try {
  corepack pnpm@$PNPM_VERSION add (Get-ChildItem (Join-Path $KIT_DIR 'plugins\*.tgz') | ForEach-Object { $_.FullName })
} finally {
  Pop-Location
}

# 5. User-global core operating rules.
Copy-Item (Join-Path $KIT_DIR 'rules\AGENTS.md') (Join-Path $DSH_HOME 'AGENTS.md') -Force

Write-Host
Write-Host '== done =='
Write-Host "   DSH_HOME : $DSH_HOME"
Write-Host '   start    : dsh web --port 3080   (or .\start.ps1)'
Write-Host '   docs     : open USERGUIDE.md for first-run checks and per-machine config (openCommand).'
