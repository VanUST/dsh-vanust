# Easy startup for the dsh web GUI (Windows).
#
# PURPOSE
#   Start the harness so a restart is also the moment the machine converges on
#   the kit: the profile is composed once, at boot, so a plugin, a patch row or
#   a harness pin changed in the kit otherwise waits for someone to remember a
#   manual step.
# INPUTS
#   $env:DSH_HOME  harness home (default %USERPROFILE%\.npm\dsh)
#   $env:PORT      listen port (default 3080)
#   $env:HEADROOM  set to 0 to boot without the Headroom overlay even when enabled
#   -NoUpdate      boot without checking the kit
#   -Yes           apply any pending kit update without asking
#   -CheckOnly     report kit drift and exit without booting
# OUTPUTS
#   Exit code of `dsh web` (0 when it exits cleanly), or 1 when the kit check
#   fails. The update decision, the composed plugin rows and the token URL are
#   printed to the console.
# KEYWORDS
#   dsh-kit, startup, convergence, DSH_HOME, port, token URL
#
# BEHAVIOUR ON EDGE CASES
#   - No kit checkout next to this script: boots anyway, because a machine can
#     legitimately run a profile that no kit manages.
#   - No profile yet: prints the installer to run and exits 1 instead of booting
#     a harness with nothing composed.
#   - Headroom enabled but its proxy cannot be made healthy: the overlay is NOT
#     added and the reason is printed, because a redirect to a dead loopback port
#     fails every model request.
param(
  [switch]$NoUpdate,
  [switch]$Yes,
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

if (-not $env:DSH_HOME) { $env:DSH_HOME = Join-Path $env:USERPROFILE '.npm\dsh' }
$port = if ($env:PORT) { $env:PORT } else { '3080' }
$kit = Split-Path -Parent $MyInvocation.MyCommand.Path
$updater = Join-Path $kit 'scripts\kit-update.mjs'
$profile = Join-Path $env:DSH_HOME 'profiles\web\cordis.patch.yml'

if (-not (Test-Path $profile)) {
  Write-Host "no web profile at $profile yet"
  Write-Host 'run the installer first:  powershell -ExecutionPolicy Bypass -File install.ps1'
  exit 1
}

if (-not $NoUpdate -and (Test-Path $updater)) {
  $updateArgs = @($updater, '--check', '--fetch', '--json', '--kit', $kit, '--home', $env:DSH_HOME)
  $reportFile = Join-Path $env:TEMP "dsh-kit-start-$PID.json"
  # Capture through a file: the updater logs to stderr by design, and merging
  # streams would corrupt the single JSON object parsed here.
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & node @updateArgs 1>$reportFile 2>$null
    $report = if (Test-Path $reportFile) { Get-Content $reportFile -Raw | ConvertFrom-Json } else { $null }
  } finally {
    $ErrorActionPreference = $previous
    Remove-Item $reportFile -Force -ErrorAction SilentlyContinue
  }
  $actions = @($report.plan | ForEach-Object { $_.action })
  if ($actions.Count -gt 0) {
    Write-Host "dsh-kit has pending changes: $($actions -join ', ')"
    if ($CheckOnly) { exit 0 }
    $apply = $Yes
    if (-not $apply -and [Environment]::UserInteractive) {
      $apply = (Read-Host 'apply now? [y/N]') -match '^(y|yes)$'
    }
    if ($apply) {
      & node $updater '--apply' '--kit' $kit '--home' $env:DSH_HOME
      if ($LASTEXITCODE -ne 0) { Write-Error 'kit update failed; not booting.'; exit 1 }
      & dsh --profile web --dump-config | Select-String -Pattern '^- id: (notify|presentation|diagrams|work-modes|godot-mcp)$' -Context 0,3
    } else {
      Write-Warning 'booting without applying the kit update'
    }
  }
  if ($CheckOnly) { exit 0 }
}

# Headroom: the same opt-in gate as start.sh. The proxy is started first and the
# overlay is added ONLY when it answers, because a redirect to a dead loopback port
# would fail every model request. No overlay, no compression - never a dead model.
$HeadroomMarker = Join-Path $env:DSH_HOME 'headroom\enabled'
$HeadroomPatch = Join-Path $env:DSH_HOME 'headroom\patch.yml'
$HeadroomScript = Join-Path $kit 'scripts\headroom.mjs'
$patchArgs = @()
if ($env:HEADROOM -ne '0' -and (Test-Path $HeadroomMarker) -and (Test-Path $HeadroomPatch) -and (Test-Path $HeadroomScript)) {
  $ensureOut = & node $HeadroomScript ensure --home $env:DSH_HOME 2>&1
  if ($LASTEXITCODE -eq 0) {
    $patchArgs = @('--patch', $HeadroomPatch)
    Write-Host 'headroom: compression active on every model request'
  } else {
    Write-Warning 'headroom is enabled but its proxy is not healthy; booting WITHOUT compression'
    ($ensureOut | Select-String -Pattern '^\s*error: ') | ForEach-Object { Write-Warning "reason:$($_)" }
    Write-Host '  see: node scripts/headroom.mjs doctor'
  }
}

& dsh web @patchArgs --port $port
exit $LASTEXITCODE
