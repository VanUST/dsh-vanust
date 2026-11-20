# dsh wrapper (installed by dsh-kit): check the machine against the kit before the
# harness boots, so a plain `dsh web` is also the moment the machine catches up.
# Windows counterpart of the `$DSH_HOME/bin/dsh` wrapper install.sh writes.
#
# WHY THIS EXISTS
#   The harness composes a profile once, at boot. A kit change (a repacked plugin, a
#   new profile row, a fix) therefore needs an install/restart pair. On Linux the
#   wrapper in $DSH_HOME/bin is that pair; without this file Windows had no wrapper at
#   all, so convergence happened exactly when a server was most likely running.
#
# WHAT IT DOES
#   1. asks kit-update --check (read-only) what is pending - harness and external tools
#      are left out, so a launch stays fast and offline,
#   2. if something is pending, prints the actions and asks once before applying,
#   3. boots the installed harness through the SAME node entry point kit-update uses.
#
# SAFETY
#   - A server that answers HTTP on the profile port makes it skip: editing the patch
#     under a live server disposes live plugins ("deferred tools").
#   - DSH_KIT_BOOT=0 skips the convergence entirely.
#   - DSH_KIT_DIR overrides the kit location (baked in below at install time).
#   - Output goes to <DSH_HOME>\kit-boot.log; a failure prints one line and STILL
#     boots the harness - a broken kit must not lock the human out.
#   - No -NoOpen here: the wrapper is a launcher, so `dsh web` keeps its own default.
$ErrorActionPreference = 'Stop'

$Kit = if ($env:DSH_KIT_DIR) { $env:DSH_KIT_DIR } else { '@KIT_DIR@' }
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.npm\dsh' }
$port = if ($env:PORT) { $env:PORT } else { '3080' }
$log = Join-Path $dshHome 'kit-boot.log'
$update = Join-Path $Kit 'scripts\kit-update.mjs'

# Resolve the installed harness WITHOUT calling the npm shim `dsh`: this file shadows
# it, and calling it would recurse. The shim sits at <prefix>\dsh.cmd, so its directory
# is npm's global bin directory; the JavaScript entry point is the same one kit-update
# spawns, which keeps the launch free of .cmd quoting and of PATH ambiguity.
$npmPrefix = $null
$dshShim = Get-Command 'dsh.cmd' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($dshShim) {
  $npmPrefix = Split-Path -Parent $dshShim.Source
} elseif ($env:NPM_PREFIX) {
  $npmPrefix = $env:NPM_PREFIX
} else {
  $configured = (& npm config get prefix 2>$null | Out-String).Trim()
  if ($configured) { $npmPrefix = $configured }
}
$entry = if ($npmPrefix) { Join-Path $npmPrefix 'node_modules\@deepseek-ai\dsh\lib\bin.js' } else { '' }
if (-not $entry -or -not (Test-Path $entry)) {
  [Console]::Error.WriteLine("dsh: cannot find the installed harness under '$npmPrefix' - run install.ps1 first")
  exit 1
}

if ($env:DSH_KIT_BOOT -ne '0' -and (Test-Path $update)) {
  $reportFile = Join-Path ([IO.Path]::GetTempPath()) ("dsh-kit-wrapper-" + $PID + ".json")
  try {
    # Capture stdout through a file: the updater logs to stderr by design, so merging
    # the streams would corrupt the single JSON object parsed here.
    $checkArgs = @($update, '--check', '--json', '--no-harness', '--no-tools', '--port', $port, '--kit', $Kit, '--home', $dshHome)
    & node @checkArgs 1>$reportFile 2>>$log
    $report = $null
    if (Test-Path $reportFile) { $report = Get-Content $reportFile -Raw | ConvertFrom-Json }
    $actions = @($report.plan | ForEach-Object { $_.action })
    if ($report -and $report.server -and $report.server.running) {
      Write-Host "dsh: kit update skipped - a server answers HTTP on port $port; stop it and launch again"
    } elseif ($actions.Count -gt 0) {
      Write-Host "dsh-kit has pending changes: $($actions -join ', ')"
      $apply = $false
      if ([Environment]::UserInteractive) {
        $apply = (Read-Host 'apply now? [y/N]') -match '^(y|yes)$'
      } else {
        Write-Host 'not an interactive shell: reporting the update without applying it'
      }
      if ($apply) {
        $applyArgs = @($update, '--apply', '--no-harness', '--no-tools', '--keep-model-config', '--port', $port, '--kit', $Kit, '--home', $dshHome)
        & node @applyArgs *>> $log
        if ($LASTEXITCODE -ne 0) {
          Write-Host "dsh: kit update failed - see $log"
        } else {
          Write-Host "dsh: kit updated - see $log; the new profile is composed by this launch"
        }
      }
    }
  } catch {
    Write-Host "dsh: kit update skipped - $($_.Exception.Message) (see $log)"
  } finally {
    Remove-Item $reportFile -Force -ErrorAction SilentlyContinue
  }
}

& node $entry @args
exit $LASTEXITCODE
