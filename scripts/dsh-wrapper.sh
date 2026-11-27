#!/bin/sh
# dsh wrapper (installed by dsh-kit): pin the Node 24 runtime and make a plain
# `dsh web` the ONLY command a human needs - it converges the machine on the kit,
# refuses to boot a stale profile, and restarts on request.
#
# WHY THIS EXISTS
#   The harness composes a profile once, at boot. A kit change (a repacked plugin,
#   a new profile row) therefore needs an install/restart pair. Running it here
#   means every launch is that pair, without anyone remembering.
#
# WHAT IT DECIDES, AND ON WHOSE ANSWER
#   It asks `kit-update --check --json` - the one owner of "is this machine the
#   kit" and "does a server answer on the profile port" - and then takes exactly
#   one of three paths:
#     no drift            -> exec the harness (fast, touches nothing)
#     drift, port free    -> --apply --no-harness --no-tools --keep-model-config, then exec
#     drift, server live  -> REFUSE (exit 1): booting now would run the profile the
#                            machine already had, which is the failure this file
#                            exists to prevent. `dsh web --restart` does the whole
#                            sequence: stop the server, converge, start.
#
#   It used to guess with `pgrep -f "node .*(bin\.js|dsh) web"`: any match printed
#   "kit update skipped" and the launch went ahead on the old profile. That is how
#   a machine stayed two orchestrator builds behind its own tree with no warning.
#   The port probe in kit-update is the measurement; a second, string-shaped answer
#   here would be the "rule lives in two places" defect this kit keeps paying for.
#
# SAFETY AND ESCAPES
#   - DSH_KIT_BOOT=0 skips the whole decision and execs the harness as-is.
#   - DSH_KIT_DIR overrides the kit location; DSH_HOME overrides the harness home.
#   - Divergence is decided by kit-update (content hashes), never by this script.
#   - A failed convergence prints one line and exits 1: booting the previous
#     profile after a failed apply is a silent stale start, not a rescue.
#   - Every decision is appended to <DSH_HOME>/kit-boot.log, so a refused or
#     skipped boot leaves a record instead of a mystery.
NODE="$HOME/.npm/node/bin/node"
ENTRY="$(readlink -f "$HOME/.npm/node/bin/dsh")"
KIT="${DSH_KIT_DIR:-@KIT_DIR@}"
HOME_DIR="${DSH_HOME:-$HOME/.npm/dsh}"
LOG="$HOME_DIR/kit-boot.log"

log_line() {
  mkdir -p "$(dirname "$LOG")" 2>/dev/null
  printf '%s %s\n' "$(date -Is 2>/dev/null || date)" "$*" >>"$LOG" 2>/dev/null
}

# `--restart` (and its historical spelling `--kit-restart`) is this wrapper's flag,
# not the harness's: take it out of the argument list wherever it sits and keep every
# other argument byte-for-byte. Both spellings are consumed because the refusal
# message and the procedure tell the human `dsh web --restart`; a flag the code does
# not parse is a message that teaches a command which does nothing.
RESTART=0
KEPT=""
for arg in "$@"; do
  case "$arg" in
    --kit-restart|--restart) RESTART=1 ;;
    *) KEPT="$KEPT
$arg" ;;
  esac
done
OLD_IFS=$IFS
IFS='
'
set -f
# shellcheck disable=SC2086 # deliberate: one argument per line, spaces preserved
set -- $KEPT
set +f
IFS=$OLD_IFS

# Only a boot has a profile to converge; `dsh --version` and the CLI subcommands
# must not pay for a convergence they cannot use.
SUBCOMMAND="${1:-}"
PORT=""
prev=""
for arg in "$@"; do
  case "$prev" in --port) PORT="$arg" ;; esac
  case "$arg" in --port=*) PORT="${arg#--port=}" ;; esac
  prev="$arg"
done

if [ "${DSH_KIT_BOOT:-1}" = "0" ] || [ "$SUBCOMMAND" != "web" ] || [ ! -f "$KIT/scripts/kit-update.mjs" ]; then
  exec "$NODE" "$ENTRY" "$@"
fi

# One question, one owner. `unknown` means the check itself failed: that is not
# evidence of drift, so the boot proceeds and says so.
STATUS=$(
  if [ -n "$PORT" ]; then
    "$NODE" "$KIT/scripts/kit-update.mjs" --check --json --kit "$KIT" --port "$PORT" 2>/dev/null
  else
    "$NODE" "$KIT/scripts/kit-update.mjs" --check --json --kit "$KIT" 2>/dev/null
  fi |
  "$NODE" -e '
    let raw = ""
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => { raw += chunk })
    process.stdin.on("end", () => {
      try {
        const report = JSON.parse(raw)
        const server = report.server ?? {}
        const pids = Array.isArray(server.pids) ? server.pids.join(",") : ""
        process.stdout.write([report.drift ? "drift" : "clean", server.running ? "up" : "down", pids, server.port ?? ""].join("\t"))
      } catch {
        process.stdout.write("unknown\t\t\t")
      }
    })
  '
)
STATE=$(printf '%s' "$STATUS" | cut -f1)
SERVER=$(printf '%s' "$STATUS" | cut -f2)
PIDS=$(printf '%s' "$STATUS" | cut -f3)
SERVER_PORT=$(printf '%s' "$STATUS" | cut -f4)

converge() {
  log_line "converge start (drift, server ${1})"
  if [ -n "$PORT" ]; then
    "$NODE" "$KIT/scripts/kit-update.mjs" --apply --no-harness --no-tools --keep-model-config --kit "$KIT" --port "$PORT" >>"$LOG" 2>&1
  else
    "$NODE" "$KIT/scripts/kit-update.mjs" --apply --no-harness --no-tools --keep-model-config --kit "$KIT" >>"$LOG" 2>&1
  fi
  if [ $? -eq 0 ]; then
    log_line "converge ok"
    return 0
  fi
  log_line "converge FAILED"
  echo "dsh: kit convergence failed - see $LOG" >&2
  echo "dsh: refusing to boot the previous profile. Fix the kit, or run 'DSH_KIT_BOOT=0 dsh web' to boot it anyway." >&2
  exit 1
}

stop_running_server() {
  # Stop the server the check named, wait for the port to go quiet, then let the boot
  # proceed. The wait asks the same check, so nothing here guesses.
  log_line "restart requested: stopping server pids ${PIDS:-?}"
  for pid in $(printf '%s' "$PIDS" | tr ',' ' '); do
    kill -TERM "$pid" 2>/dev/null || true
  done
  tries=0
  still=up
  while [ "$tries" -lt 40 ]; do
    sleep 0.5
    tries=$((tries + 1))
    still=$(
      if [ -n "$PORT" ]; then
        "$NODE" "$KIT/scripts/kit-update.mjs" --check --json --kit "$KIT" --port "$PORT" 2>/dev/null
      else
        "$NODE" "$KIT/scripts/kit-update.mjs" --check --json --kit "$KIT" 2>/dev/null
      fi |
      "$NODE" -e '
        let raw = ""
        process.stdin.setEncoding("utf8")
        process.stdin.on("data", (chunk) => { raw += chunk })
        process.stdin.on("end", () => {
          try { process.stdout.write((JSON.parse(raw).server ?? {}).running ? "up" : "down") } catch { process.stdout.write("down") }
        })
      '
    )
    [ "$still" = "down" ] && break
  done
  if [ "$still" = "up" ]; then
    log_line "restart FAILED: server did not stop"
    echo "dsh: the running dsh web server did not stop after 20s - stopping it by hand is the only safe next step." >&2
    exit 1
  fi
  SERVER=down
  log_line "restart: server stopped"
}

# `--restart` asks for a restart even when the kit is already converged, so the stop
# happens before the state is judged: the boot that follows must find the port free.
if [ "$RESTART" = "1" ] && [ "$SERVER" = "up" ]; then
  stop_running_server
fi

case "$STATE" in
  clean)
    # Nothing to do: the machine is the kit.
    ;;
  drift)
    if [ "$SERVER" = "up" ]; then
      log_line "refused: drift with a live server on port ${SERVER_PORT:-?} (pids ${PIDS:-?})"
      echo "dsh: the kit has changes and a dsh web server is already running (port ${SERVER_PORT:-?}, pid ${PIDS:-?})." >&2
      echo "dsh: booting now would run the profile the machine already had - refusing." >&2
      echo "dsh: run 'dsh web --restart' to stop it, converge the kit and start again." >&2
      exit 1
    fi
    converge "$SERVER"
    ;;
  *)
    echo "dsh: could not read the kit state from $KIT/scripts/kit-update.mjs - booting as-is (see $LOG)" >&2
    log_line "unknown kit state; booting as-is"
    ;;
esac

# EGRESS HOOK: a machine can need the harness's model traffic to leave by a specific path -
# here a selective proxy whose OpenAI/ChatGPT destinations go through a VPN the rest of the
# machine does not use. The kit stays portable, so the variables live in a machine-owned file,
# and they are applied only while that proxy's port answers: a stopped proxy must not break
# every model call. The port is declared in the file as "# dsh-egress-port: <port>".
EGRESS_ENV_FILE="${DSH_EGRESS_ENV_FILE:-$HOME/.config/dsh/egress.env}"
if [ -f "$EGRESS_ENV_FILE" ]; then
  EGRESS_PORT=$(sed -n 's/^# dsh-egress-port:[[:space:]]*//p' "$EGRESS_ENV_FILE" | head -n 1)
  if [ -n "$EGRESS_PORT" ] && command -v bash >/dev/null 2>&1 && timeout 1 bash -c "exec 3<>/dev/tcp/127.0.0.1/$EGRESS_PORT" 2>/dev/null; then
    set -a
    . "$EGRESS_ENV_FILE"
    set +a
  fi
fi

exec "$NODE" "$ENTRY" "$@"
