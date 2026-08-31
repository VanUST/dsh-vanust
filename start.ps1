# Easy startup for the dsh web GUI (Windows).
$env:DSH_HOME = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.npm\dsh' }
$port = if ($env:PORT) { $env:PORT } else { '3080' }
& dsh web --port $port
