#!/usr/bin/env bash
# Easy startup for the dsh web GUI (Linux/macOS).
#
# PURPOSE
#   Start the harness so a restart is also the moment the machine converges on
#   the kit: the profile is composed once, at boot, so a plugin, a patch row or
#   a harness pin changed in the kit otherwise waits for someone to remember a
#   manual step.
# INPUTS
#   DSH_HOME  harness home (default ~/.npm/dsh)
#   PORT      listen port (default 3080)
#   KIT_UPDATE=0   boot without checking the kit
#   HEADROOM=0     boot without the Headroom compression overlay even when enabled
# OUTPUTS
#   Exit code of `dsh web`, or 1 when the kit check fails or no profile exists.
#   The update decision and the token URL are printed to the console.
# KEYWORDS
#   dsh-kit, startup, convergence, DSH_HOME, port, token URL, headroom
#
# BEHAVIOUR ON EDGE CASES
#   - No kit checkout next to this script: boots anyway, because a machine can
#     legitimately run a profile that no kit manages.
#   - No profile yet: prints the installer to run and exits 1 instead of booting
#     a harness with nothing composed.
#   - Non-interactive stdin: a pending update is reported and skipped rather
#     than applied unseen.
#   - Headroom enabled but its proxy cannot be made healthy: the overlay is NOT
#     added and the reason is printed, because a redirect to a dead 127.0.0.1
#     port fails every model request. Losing compression is recoverable; losing
#     the model is not.
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.npm/dsh}"
export DSH_HOME
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATER="${KIT_DIR}/scripts/kit-update.mjs"
PROFILE="${DSH_HOME}/profiles/web/cordis.patch.yml"
HEADROOM_MARKER="${DSH_HOME}/headroom/enabled"
HEADROOM_PATCH="${DSH_HOME}/headroom/patch.yml"

if [ ! -f "${PROFILE}" ]; then
  echo "no web profile at ${PROFILE} yet" >&2
  echo "run the installer first:  ./install.sh" >&2
  exit 1
fi

if [ "${KIT_UPDATE:-1}" != "0" ] && [ -f "${UPDATER}" ]; then
  REPORT="$(node "${UPDATER}" --check --fetch --json --kit "${KIT_DIR}" --home "${DSH_HOME}" 2>/dev/null || true)"
  if printf '%s' "${REPORT}" | grep -q '"action"'; then
    echo "dsh-kit has pending changes:"
    printf '%s' "${REPORT}" | grep -o '"action": *"[a-z-]*"' | sed 's/.*"\([a-z-]*\)"$/  - \1/' || true
    if [ -t 0 ]; then
      read -r -p 'apply now? [y/N] ' answer
      case "${answer}" in
        y|Y|yes|YES)
          node "${UPDATER}" --apply --kit "${KIT_DIR}" --home "${DSH_HOME}"
          ;;
        *) echo 'booting without applying the kit update' >&2 ;;
      esac
    else
      echo 'no interactive stdin; booting without applying the kit update' >&2
    fi
  fi
fi

PATCH_ARGS=()
if [ "${HEADROOM:-1}" != "0" ] && [ -f "${HEADROOM_MARKER}" ] && [ -f "${HEADROOM_PATCH}" ] && [ -f "${KIT_DIR}/scripts/headroom.mjs" ]; then
  # The reason matters: "not healthy" alone sends the operator to a log. The
  # script's own `error:` line is the one sentence that says what to fix.
  if ENSURE_OUT="$(node "${KIT_DIR}/scripts/headroom.mjs" ensure --home "${DSH_HOME}" 2>&1)"; then
    PATCH_ARGS=(--patch "${HEADROOM_PATCH}")
    echo "headroom: compression active on every model request" >&2
  else
    echo "headroom is enabled but its proxy is not healthy; booting WITHOUT compression" >&2
    printf '%s\n' "${ENSURE_OUT}" | sed -n 's/^  error: /  reason: /p' >&2
    echo "  see: node scripts/headroom.mjs doctor" >&2
  fi
fi

# `dsh web` opens a browser by itself unless --no-open is passed. A boot nobody asked
# to see - a supervisor, a restart after convergence - must not put a window on screen,
# so it is quiet unless OPEN=1 says an interactive launcher wants it.
OPEN_ARGS=()
if [ "${OPEN:-0}" != "1" ]; then OPEN_ARGS=(--no-open); fi

exec dsh web ${PATCH_ARGS[@]+"${PATCH_ARGS[@]}"} ${OPEN_ARGS[@]+"${OPEN_ARGS[@]}"} --port "${PORT:-3080}"
