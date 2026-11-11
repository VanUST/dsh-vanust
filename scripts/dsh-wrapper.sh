#!/bin/sh
# dsh wrapper (installed by dsh-kit): pin the Node 24 runtime and converge the
# machine on the kit before the harness boots, so a plain `dsh web` picks up new
# plugins, profile rows and fixes - no start.sh, no manual install step.
#
# WHY THIS EXISTS
#   The harness composes a profile once, at boot. A kit change (a repacked
#   plugin, a new profile row) therefore needs an install/restart pair. Running
#   it here means every launch is that pair, without anyone remembering.
#
# SAFETY
#   - A running `dsh web` makes it skip: editing the patch under a live server
#     disposes live plugins (the "deferred tools" failure).
#   - DSH_KIT_BOOT=0 skips the convergence entirely.
#   - DSH_KIT_DIR overrides the kit location.
#   - Output goes to <DSH_HOME>/kit-boot.log; a failure prints one line and
#     still boots the harness (a broken kit must not lock the human out).
#
# The kit-update flags: --no-harness and --no-tools keep the boot fast and
# offline; --keep-model-config preserves the machine's provider/model/effort
# choice, because a cost setting is not a kit artefact.
NODE="$HOME/.npm/node/bin/node"
ENTRY="$(readlink -f "$HOME/.npm/node/bin/dsh")"
KIT="${DSH_KIT_DIR:-@KIT_DIR@}"

if [ "${DSH_KIT_BOOT:-1}" != "0" ] && [ -f "$KIT/scripts/kit-update.mjs" ]; then
  if pgrep -f "node .*(bin\.js|dsh) web" >/dev/null 2>&1; then
    echo "dsh: kit update skipped - a dsh web server is running; stop it and launch again" >&2
  else
    LOG="${DSH_HOME:-$HOME/.npm/dsh}/kit-boot.log"
    mkdir -p "$(dirname "$LOG")"
    if ! "$NODE" "$KIT/scripts/kit-update.mjs" --apply --no-harness --no-tools --keep-model-config >>"$LOG" 2>&1; then
      echo "dsh: kit update failed - see $LOG" >&2
    fi
  fi
fi

exec "$NODE" "$ENTRY" "$@"
