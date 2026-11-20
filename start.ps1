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
#   $env:SESSION_STORE  set to 0 to boot without the session-store guard
#   -NoUpdate      boot without checking the kit
#   -Yes           apply any pending kit update without asking
#   -CheckOnly     report kit drift and exit without booting
#   -Open          open the Web UI in the default browser after booting. WITHOUT it
#                  the boot prints the token URL and opens nothing: `dsh web` opens
#                  the browser by itself unless `--no-open` is passed, and a boot that
#                  nobody asked to see (a supervisor, a restart after convergence)
#                  must never put a window on screen. Interactive launchers pass it.
# OUTPUTS
#   Exit code of `dsh web` (0 when it exits cleanly), or 1 when the kit check
#   fails or a server already answers on the profile port. The update decision,
#   the composed plugin rows and the token URL are printed to the console.
# KEYWORDS
#   dsh-kit, startup, convergence, DSH_HOME, port, token URL
#
# BEHAVIOUR ON EDGE CASES
#   - No kit checkout next to this script: boots anyway, because a machine can
#     legitimately run a profile that no kit manages.
#   - No profile yet: prints the installer to run and exits 1 instead of booting
#     a harness with nothing composed.
#   - One unreadable session log: the store guard moves it out first, because dsh
#     aborts the WHOLE cross-workspace listing on any error it does not recognise as
#     corruption - one file the OS refuses leaves the UI with no history and no way to
#     start a chat. Every byte is kept and the move is printed; silence means nothing
#     was wrong.
param(
  [switch]$NoUpdate,
  [switch]$Yes,
  [switch]$CheckOnly,
  [switch]$Open
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
  $updateArgs = @($updater, '--check', '--fetch', '--json', '--port', $port, '--kit', $kit, '--home', $env:DSH_HOME)
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
  # The live-server watchdog, read from the same check: a server that answers HTTP on
  # the profile port makes an apply unsafe (the patch is edited under a live server, and
  # its next page load dies with "Failed to load plugins"). Windows has no /proc, so the
  # port answer is the check that exists here; kit-update reports it on every platform.
  $serverRunning = [bool]($report -and $report.server -and $report.server.running)
  if ($actions.Count -gt 0) {
    Write-Host "dsh-kit has pending changes: $($actions -join ', ')"
    if ($CheckOnly) { exit 0 }
    if ($serverRunning) {
      Write-Host "a server already answers on the profile port $port - stop it, then run this again"
      Write-Host 'the kit is not applied under a live server: its profile is composed at boot and a reload mid-apply composes a half-applied state'
      exit 1
    }
    $apply = $Yes
    if (-not $apply -and [Environment]::UserInteractive) {
      $apply = (Read-Host 'apply now? [y/N]') -match '^(y|yes)$'
    }
    if ($apply) {
      & node $updater '--apply' '--port' $port '--kit' $kit '--home' $env:DSH_HOME
      if ($LASTEXITCODE -ne 0) { Write-Error 'kit update failed; not booting.'; exit 1 }
      & dsh --profile web --dump-config | Select-String -Pattern '^- id: (notify|diagrams|work-modes|godot-mcp)$' -Context 0,3
    } else {
      Write-Warning 'booting without applying the kit update'
    }
  }
  if ($CheckOnly) { exit 0 }
}

# The session store decides whether the UI has any history at all; see the header.
$SessionStoreScript = Join-Path $kit 'scripts\session-store.mjs'
if ($env:SESSION_STORE -ne '0' -and (Test-Path $SessionStoreScript)) {
  & node $SessionStoreScript ensure --quiet --home $env:DSH_HOME
}

$openArgs = if ($Open) { @() } else { @('--no-open') }
& dsh web --port $port @openArgs
exit $LASTEXITCODE
