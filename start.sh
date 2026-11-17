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
#   SESSION_STORE=0  boot without the session-store guard
# OUTPUTS
#   Exit code of `dsh web`, or 1 when the kit check fails or no profile exists.
#   The update decision and the token URL are printed to the console.
# KEYWORDS
#   dsh-kit, startup, convergence, DSH_HOME, port, token URL
#
# BEHAVIOUR ON EDGE CASES
#   - No kit checkout next to this script: boots anyway, because a machine can
#     legitimately run a profile that no kit manages.
#   - No profile yet: prints the installer to run and exits 1 instead of booting
#     a harness with nothing composed.
#   - Non-interactive stdin: a pending update is reported and skipped rather
#     than applied unseen.
#   - One unreadable session log: the store guard moves it out first. dsh aborts the
#     WHOLE cross-workspace listing on any error it does not recognise as corruption,
#     so a single file the OS refuses (an on-access scanner returning EPERM is the
#     local case) leaves the UI with no history and no way to start a chat. The guard
#     keeps every byte and prints what it moved; with nothing to do it says nothing.
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.npm/dsh}"
export DSH_HOME
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATER="${KIT_DIR}/scripts/kit-update.mjs"
PROFILE="${DSH_HOME}/profiles/web/cordis.patch.yml"

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

# The session store decides whether the UI has any history at all. dsh treats an
# unreadable session log as fatal rather than skippable, so one file the OS refuses
# aborts the whole cross-workspace listing: `workspace` never activates, four plugins
# that inject workspaceRegistry stay pending, and `dsh web` serves an empty history that
# cannot create a chat - all my chats are gone, when every byte is still on disk. The
# guard moves only what is refused into $DSH_HOME/sessions-quarantine with a README, and
# prints nothing when there is nothing to do.
if [ "${SESSION_STORE:-1}" != "0" ] && [ -f "${KIT_DIR}/scripts/session-store.mjs" ]; then
  STORE_OUT="$(node "${KIT_DIR}/scripts/session-store.mjs" ensure --quiet --home "${DSH_HOME}" 2>&1 || true)"
  if [ -n "${STORE_OUT}" ]; then printf '%s\n' "${STORE_OUT}" >&2; fi
fi

# `dsh web` opens a browser by itself unless --no-open is passed. A boot nobody asked
# to see - a supervisor, a restart after convergence - must not put a window on screen,
# so it is quiet unless OPEN=1 says an interactive launcher wants it.
OPEN_ARGS=()
if [ "${OPEN:-0}" != "1" ]; then OPEN_ARGS=(--no-open); fi

exec dsh web ${OPEN_ARGS[@]+"${OPEN_ARGS[@]}"} --port "${PORT:-3080}"
