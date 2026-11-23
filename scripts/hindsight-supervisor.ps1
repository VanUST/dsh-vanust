# Hindsight supervisor for the local daemon.
#
# PURPOSE
#   Keep the local Hindsight API listening while the DeepSeek Harness is in use. The
#   daemon is an embedded PostgreSQL plus the extraction API; if either dies, the API
#   stops and every hindsight_* tool answers ECONNREFUSED. Hindsight's own launcher
#   starts one process and exits, and its Windows Run key only runs at logon, so a
#   crash left memory down until the next manual start.
#
#   This supervisor is started by the dsh wrapper through WMI (outside the server's
#   process tree) and by the per-user Run key at logon. It starts the launcher when
#   the API port is closed and restarts it when it exits; when the daemon is healthy
#   it only checks the port. The launcher owns the API key and provider settings.
#
# INPUTS
#   $env:HINDSIGHT_API_PORT  port to probe (default 18888)
#   $env:USERPROFILE         where .hindsight/start-coding-agent.ps1 and the logs live
#
# OUTPUTS
#   Appends one line per decision to ~/.hindsight/supervisor.log and the launcher's
#   output to the same file. Runs forever; stop it with the program that started it.
#
# KEYWORDS
#   hindsight, supervisor, daemon, watchdog, embedded postgres, windows

$ErrorActionPreference = 'Continue'
$launcher = Join-Path $env:USERPROFILE '.hindsight\start-coding-agent.ps1'
$log = Join-Path $env:USERPROFILE '.hindsight\supervisor.log'
$port = if ($env:HINDSIGHT_API_PORT) { [int]$env:HINDSIGHT_API_PORT } else { 18888 }

function Write-SupervisorLog([string]$Message) {
  try {
    $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $Message
    Add-Content -Path $log -Value $line -Encoding utf8
  } catch {
    # A log that cannot be written must not stop the supervisor.
  }
}

function Test-HindsightPort([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    if (-not $task.Wait(800)) { return $false }
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

Write-SupervisorLog "supervisor start (pid $PID, port $port)"
while ($true) {
  if (-not (Test-HindsightPort $port)) {
    if (-not (Test-Path $launcher)) {
      Write-SupervisorLog "launcher missing: $launcher"
      Start-Sleep -Seconds 30
      continue
    }
    Write-SupervisorLog 'daemon not listening; starting launcher'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher *>> $log
    $code = $LASTEXITCODE
    Write-SupervisorLog "launcher exited $code"
    if ($code -ne 0) { Start-Sleep -Seconds 30; continue }
  }
  Start-Sleep -Seconds 10
}
