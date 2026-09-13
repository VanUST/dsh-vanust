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

exec dsh web --port "${PORT:-3080}"
