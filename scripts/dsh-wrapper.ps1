# dsh wrapper (installed by dsh-kit): check the machine against the kit before the
# harness boots, so a plain 'dsh web' is also the moment the machine catches up.
# Windows counterpart of the $DSH_HOME/bin/dsh wrapper install.sh writes.
#
# WHY THIS EXISTS
#   The harness composes a profile once, at boot. A kit change (a repacked plugin, a
#   new profile row, a fix) therefore needs an install/restart pair. On Linux the
#   wrapper in $DSH_HOME/bin is that pair; without this file Windows had no wrapper at
#   all, so convergence happened exactly when a server was most likely running.
#
# WHAT IT DOES (only for the 'web' subcommand)
#   1. asks kit-update --check (read-only) what is pending - harness and external tools
#      are left out, so a launch stays fast and offline,
#   2. no server running:
#        pending changes -> prints the actions, asks once, applies, then boots;
#        no changes      -> boots.
#   3. a server already answers on the requested port:
#        no changes      -> prints that it is already running and exits 0;
#        pending changes -> explains that a restart ends its sessions, asks once,
#                           stops that server, applies, then boots the new version.
#
# SAFETY
#   - Never edits the profile under a live server: it stops the server first, and it
#     refuses outright when this process is itself a descendant of a dsh web server
#     (an agent running 'dsh web' must not kill the session that hosts it).
#   - DSH_KIT_BOOT=0 skips the convergence entirely.
#   - DSH_KIT_DIR overrides the kit location (baked in below at install time).
#   - Output goes to <DSH_HOME>\kit-boot.log; a failed update does not boot a
#     half-applied profile - it reports and exits 1.
#   - No -NoOpen here: the wrapper is a launcher, so 'dsh web' keeps its own default.
$ErrorActionPreference = 'Stop'

$Kit = if ($env:DSH_KIT_DIR) { $env:DSH_KIT_DIR } else { '@KIT_DIR@' }
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.npm\dsh' }
$port = if ($env:PORT) { [string]$env:PORT } else { '3080' }
for ($i = 0; $i -lt $args.Count - 1; $i++) {
  if ($args[$i] -eq '--port') { $port = [string]$args[$i + 1] }
}
$log = Join-Path $dshHome 'kit-boot.log'
$update = Join-Path $Kit 'scripts\kit-update.mjs'
$isWeb = ($args.Count -gt 0 -and [string]$args[0] -eq 'web')

# Resolve the installed harness WITHOUT calling the npm shim 'dsh': this file shadows
# it, and calling it would recurse. The shim sits at <prefix>\dsh.cmd, so its directory
# is npm's global bin directory; the JavaScript entry point is the same one kit-update
# spawns, which keeps the launch free of .cmd quoting and of PATH ambiguity.
$npmPrefix = $null
$dshShim = Get-Command 'dsh.cmd' -All -CommandType Application -ErrorAction SilentlyContinue |
  Where-Object { (Split-Path -Parent $_.Source) -ne $PSScriptRoot } |
  Select-Object -First 1
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

function Test-PortOpen([string]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync('127.0.0.1', [int]$Port)
    if (-not $task.Wait(500)) { return $false }
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Get-DshServerProcesses([string]$Port) {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      if (-not $_.CommandLine) { return $false }
      if ($_.CommandLine -notmatch '(?i)dsh[\\/]lib[\\/]bin\.js') { return $false }
      if ($_.CommandLine -notmatch '(?i)(^|\s)web(\s|$)') { return $false }
      $m = [regex]::Match($_.CommandLine, '(?i)--port[ =](\d+)')
      $procPort = if ($m.Success) { $m.Groups[1].Value } else { '3080' }
      return ($procPort -eq $Port)
    }
}

# True when this wrapper was started from inside a dsh web server (an agent shell).
# Stopping the server then kills the caller, so the wrapper refuses instead.
function Test-UnderDshServer {
  $current = $PID
  for ($depth = 0; $depth -lt 12; $depth++) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction SilentlyContinue
    if (-not $proc) { return $false }
    if ($proc.ProcessId -ne $PID -and $proc.CommandLine -and $proc.CommandLine -match '(?i)dsh[\\/]lib[\\/]bin\.js' -and $proc.CommandLine -match '(?i)(^|\s)web(\s|$)') {
      return $true
    }
    $parent = [int]$proc.ParentProcessId
    if ($parent -le 0 -or $parent -eq $current) { return $false }
    $current = $parent
  }
  return $false
}

function Stop-DshServer([string]$Port) {
  $procs = @(Get-DshServerProcesses $Port)
  if ($procs.Count -eq 0) { return $false }
  foreach ($proc in $procs) {
    & taskkill.exe /PID $proc.ProcessId /T /F 2>$null | Out-Null
  }
  for ($i = 0; $i -lt 30; $i++) {
    if (-not (Test-PortOpen $Port)) { return $true }
    Start-Sleep -Seconds 1
  }
  return (-not (Test-PortOpen $Port))
}

function Invoke-KitApply {
  $applyArgs = @($update, '--apply', '--no-harness', '--no-tools', '--keep-model-config', '--port', $port, '--kit', $Kit, '--home', $dshHome)
  # Windows PowerShell 5.1 turns a native program's stderr into a terminating error under
  # ErrorActionPreference=Stop even when it is redirected. The updater logs to stderr by
  # design, so relax the preference around the call and read its exit code instead.
  $previous = $ErrorActionPreference
  $applyCode = 1
  try {
    $ErrorActionPreference = 'Continue'
    & node @applyArgs *>> $log
    $applyCode = $LASTEXITCODE
  } catch {
    $applyCode = 1
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($applyCode -ne 0) { return $false }
  $verifyFile = Join-Path ([IO.Path]::GetTempPath()) ("dsh-kit-verify-" + $PID + ".json")
  try {
    $checkArgs = @($update, '--check', '--json', '--no-harness', '--no-tools', '--port', $port, '--kit', $Kit, '--home', $dshHome)
    $ErrorActionPreference = 'Continue'
    & node @checkArgs 1>$verifyFile 2>>$log
    $ErrorActionPreference = $previous
    if (-not (Test-Path $verifyFile)) { return $false }
    $v = Get-Content $verifyFile -Raw | ConvertFrom-Json
    return (@($v.plan).Count -eq 0)
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $previous
    Remove-Item $verifyFile -Force -ErrorAction SilentlyContinue
  }
}


# The harness version the kit installers pin, or $null when the installer is absent.
function Get-KitHarnessPin {
  $installer = Join-Path $Kit 'install.ps1'
  if (-not (Test-Path $installer)) { return $null }
  try {
    $match = [regex]::Match((Get-Content $installer -Raw), '(?m)^\s*\$DSH_VERSION\s*=\s*''([^'']+)''')
    if ($match.Success) { return $match.Groups[1].Value }
  } catch { }
  return $null
}

# The harness package version the wrapper is about to boot.
function Get-InstalledHarnessVersion {
  $manifest = Join-Path $npmPrefix 'node_modules\@deepseek-ai\dsh\package.json'
  try { return (Get-Content $manifest -Raw | ConvertFrom-Json).version } catch { return $null }
}

# Align the installed harness with the kit pin before booting.
#
# The normal boot path skips the harness on purpose (fast, offline). This is the one
# check that is too important to skip: a profile written for 0.2.2 booted on 0.2.1
# loses plugins in a way that looks like a broken kit. A mismatch runs the full
# convergence, which installs the pin and records it; a failure warns and boots what
# is installed.
function Sync-HarnessPin {
  $pin = Get-KitHarnessPin
  if ($pin -eq $null -or $pin -eq '') { return }
  $installed = Get-InstalledHarnessVersion
  if ($installed -eq $pin) { return }
  Write-Host "dsh: harness $installed does not match the kit pin $pin; installing the pin"
  $applyArgs = @($update, '--apply', '--no-tools', '--keep-model-config', '--port', $port, '--kit', $Kit, '--home', $dshHome)
  $previous = $ErrorActionPreference
  $code = 1
  try {
    $ErrorActionPreference = 'Continue'
    & node @applyArgs *>> $log
    $code = $LASTEXITCODE
  } catch {
    $code = 1
  } finally {
    $ErrorActionPreference = $previous
  }
  $after = Get-InstalledHarnessVersion
  if ($after -eq $pin) {
    Write-Host "dsh: harness updated to $pin"
  } elseif ($code -ne 0) {
    Write-Host "dsh: harness pin install failed; booting $after (see $log)"
  } else {
    Write-Host "dsh: harness is still $after (kit pin $pin); booting the installed version"
  }
}

# Start the local Hindsight daemon when it is installed but not listening.
#
# serverMode daemon means the plugin only talks to a daemon that is already up; it
# does not start one (measured on hindsight-coding-agents 0.8.3). The Run key covers
# a logon, but a daemon that died, or a launch before the logon script ran, leaves
# every hindsight_* tool refused. Starting it from the same command that launches the
# harness makes "dsh web" the single entry point. It is detached through WMI so a
# later server kill cannot take the daemon with it, and a start already in progress
# (daemon-start.js) is left alone.
function Start-HindsightDaemon {
  $launcher = Join-Path $env:USERPROFILE '.hindsight\start-coding-agent.ps1'
  if (-not (Test-Path $launcher)) { return }
  $apiPort = 18888
  $configPath = Join-Path $env:USERPROFILE '.hindsight\coding-agent.json'
  if (Test-Path $configPath) {
    try {
      $configured = (Get-Content $configPath -Raw | ConvertFrom-Json).apiPort
      if ($configured) { $apiPort = [int]$configured }
    } catch { }
  }
  if (Test-PortOpen $apiPort) { return }
  $supervisor = Join-Path $Kit 'scriptshindsight-supervisor.ps1'
  $runner = if (Test-Path $supervisor) { $supervisor } else { $launcher }
  $starting = Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match '(?i)hindsight-supervisor\.ps1|daemon-start\.js' }
  if ($starting) { return }
  try {
    $line = 'cmd.exe /d /s /c "set DSH_HOME=' + $dshHome + '&& set HINDSIGHT_API_PORT=' + $apiPort + '&& powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ' + $runner + '"'
    Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $line } | Out-Null
    if ($runner -eq $supervisor) {
      Write-Host "dsh: starting the local Hindsight supervisor on $apiPort"
    } else {
      Write-Host "dsh: starting the local Hindsight daemon on $apiPort"
    }
  } catch {
    Write-Host "dsh: Hindsight daemon did not start - $($_.Exception.Message)"
  }
}

if ($isWeb) { Start-HindsightDaemon }

if ($isWeb -and $env:DSH_KIT_BOOT -ne '0' -and (Test-Path $update)) {
  $reportFile = Join-Path ([IO.Path]::GetTempPath()) ("dsh-kit-wrapper-" + $PID + ".json")
  $report = $null
  $checkError = $null
  $previous = $ErrorActionPreference
  try {
    # Capture stdout through a file: the updater logs to stderr by design, so merging
    # the streams would corrupt the single JSON object parsed here. Windows PowerShell
    # 5.1 also turns native stderr into a terminating error under Stop even when it is
    # redirected, so relax the preference around the call.
    $checkArgs = @($update, '--check', '--json', '--no-harness', '--no-tools', '--port', $port, '--kit', $Kit, '--home', $dshHome)
    $ErrorActionPreference = 'Continue'
    & node @checkArgs 1>$reportFile 2>>$log
    $ErrorActionPreference = $previous
    if (Test-Path $reportFile) { $report = Get-Content $reportFile -Raw | ConvertFrom-Json }
  } catch {
    $checkError = $_.Exception.Message
  } finally {
    $ErrorActionPreference = $previous
    Remove-Item $reportFile -Force -ErrorAction SilentlyContinue
  }
  if (-not $report) {
    Write-Host "dsh: kit check failed - $checkError (see $log)"
  }

  $actions = if ($report) { @($report.plan | ForEach-Object { $_.action }) } else { @() }
  $serverRunning = (Test-PortOpen $port) -or [bool]($report -and $report.server -and $report.server.running)

  if ($report -and $actions.Count -eq 0) {
    if ($serverRunning) {
      $pin = Get-KitHarnessPin
      $installed = Get-InstalledHarnessVersion
      if ($pin -and $pin -ne '' -and $installed -ne $pin) {
        Write-Host "dsh: harness $installed does not match the kit pin $pin; stop the server and rerun dsh web to align it"
      }
      Write-Host "dsh: already running on http://127.0.0.1:$port/ - nothing to update"
      exit 0
    }
  } elseif ($report) {
    Write-Host "dsh-kit has pending changes: $($actions -join ', ')"
    if ($serverRunning) {
      if (Test-UnderDshServer) {
        Write-Host 'dsh: refusing to stop the server that hosts this process; run dsh web from an external terminal'
        exit 1
      }
      $answer = ''
      if ([Environment]::UserInteractive) {
        $answer = Read-Host "A dsh web server is running on port $port. Stop it, apply the update and start the new version? This ends its sessions. [y/N]"
      } else {
        Write-Host 'not an interactive shell: a server is running, so nothing was stopped or applied'
        exit 0
      }
      if ($answer -notmatch '^(y|yes)$') {
        Write-Host 'dsh: left the running server untouched'
        exit 0
      }
      if (-not (Stop-DshServer $port)) {
        Write-Host "dsh: could not stop the server on port $port; stop it manually and rerun"
        exit 1
      }
      Write-Host 'dsh: server stopped; applying the kit update'
      if (-not (Invoke-KitApply)) {
        Write-Host "dsh: kit update failed; see $log. The server is stopped and was NOT restarted."
        exit 1
      }
      Write-Host 'dsh: kit updated; starting the new version'
    } else {
      $apply = $false
      if ([Environment]::UserInteractive) {
        $apply = (Read-Host 'apply now? [y/N]') -match '^(y|yes)$'
      } else {
        Write-Host 'not an interactive shell: reporting the update without applying it'
      }
      if ($apply) {
        if (-not (Invoke-KitApply)) {
          Write-Host "dsh: kit update failed; see $log"
          exit 1
        }
        Write-Host 'dsh: kit updated; the new profile is composed by this launch'
      }
    }
  }

  if (-not $report -and $serverRunning) {
    Write-Host "dsh: a server is already running on port $port and the kit state could not be read; not starting a second one"
    exit 1
  }
}

if ($isWeb -and $env:DSH_KIT_BOOT -ne '0') { Sync-HarnessPin }

& node $entry @args
exit $LASTEXITCODE
