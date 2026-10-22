#!/usr/bin/env bash
# dsh-kit installer — Linux/macOS (fresh machine setup).
#
# What it does:
#   1. checks Node >= 24 (node-pty ABI),
#   2. installs the pinned harness version globally (`npm i -g`),
#   3. creates $DSH_HOME/profiles/web from the kit's canonical profile files,
#   4. installs every plugin tarball in plugins/ into the profile (see
#      plugins/inventory.json for the set),
#   5. installs the DEPLOYMENT.md procedure to $DSH_HOME,
#
# Usage:
#   git clone <your-remote>/dsh-kit.git && cd dsh-kit
#   ./install.sh
#   dsh web --port 3080
#
# Per-machine after install: configure API credentials (first GUI run), and
# see USERGUIDE.md for Windows notes (openCommand) and first-run checks.
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_VERSION="0.2.1-rc.2"        # pinned harness version
PNPM_VERSION="11.7.0"           # matches the harness workspace toolchain
DSH_HOME="${DSH_HOME:-$HOME/.npm/dsh}"

echo "== dsh-kit installer (harness ${DSH_VERSION}) =="

# 1. Node check (node-pty is ABI-sensitive; keep the same major across machines).
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js not found — install Node >= 24 first (https://nodejs.org)." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "${NODE_MAJOR}" -lt 24 ]; then
  echo "ERROR: Node ${NODE_MAJOR} detected — dsh-kit requires Node >= 24." >&2
  exit 1
fi
echo "   node: $(node -v) (ok)"

# 2. Pinned harness install (idempotent; re-running upgrades to the pin).
#    Keep an existing user-local npm prefix (e.g. ~/.npm/node); only switch a
#    system-wide prefix to a user-local one so no sudo is needed.
CURRENT_PREFIX="$(npm config get prefix)"
case "${CURRENT_PREFIX}" in
  "${HOME}"/*) NPM_PREFIX="${CURRENT_PREFIX}" ;;
  *) NPM_PREFIX="${NPM_PREFIX:-$HOME/.npm}"
     npm config set prefix "${NPM_PREFIX}" >/dev/null
     ;;
esac
echo "   npm prefix: ${NPM_PREFIX} (user-local, no sudo needed)"
echo "   installing @deepseek-ai/dsh@${DSH_VERSION} (global)..."
npm install -g --no-audit --no-fund "@deepseek-ai/dsh@${DSH_VERSION}"
# Make the global bin dir reachable for this and future shells.
case ":$PATH:" in
  *":${NPM_PREFIX}/bin:"*) ;;
  *) export PATH="${NPM_PREFIX}/bin:${PATH}"
     echo "   PATH updated for this shell; add 'export PATH=\"${NPM_PREFIX}/bin:\$PATH\"' to ~/.bashrc"
     ;;
esac

# 3. Web profile from the canonical kit files.
mkdir -p "${DSH_HOME}/profiles/web"
if [ -f "${DSH_HOME}/profiles/web/cordis.patch.yml" ] &&
   ! diff -q "${KIT_DIR}/profile/cordis.patch.yml" "${DSH_HOME}/profiles/web/cordis.patch.yml" >/dev/null 2>&1; then
  echo "   WARN: existing cordis.patch.yml differs from the kit — keeping yours." >&2
else
  cp "${KIT_DIR}/profile/cordis.patch.yml" "${DSH_HOME}/profiles/web/cordis.patch.yml"
fi
cp "${KIT_DIR}/profile/package.json" "${DSH_HOME}/profiles/web/package.json"
cp "${KIT_DIR}/profile/pnpm-workspace.yaml" "${DSH_HOME}/profiles/web/pnpm-workspace.yaml"

# 4. Plugin tarballs (pnpm writes machine-local absolute paths into the
#    profile's package.json — the kit file stays canonical with no deps).
echo "   installing the kit plugins (see plugins/inventory.json)..."
(
  cd "${DSH_HOME}/profiles/web"
  corepack pnpm@${PNPM_VERSION} add "${KIT_DIR}"/plugins/*.tgz
)

# 5. The operating procedure, installed so a machine without the kit checked out can still
#    read how it is set up, updated and verified. Convergence afterwards is
#    `scripts/kit-update.mjs --apply`.
cp "${KIT_DIR}/rules/DEPLOYMENT.md" "${DSH_HOME}/DEPLOYMENT.md"

echo
echo "== done =="
echo "   DSH_HOME : ${DSH_HOME}"
echo "   start    : dsh web --port 3080   (or ./start.sh)"
echo "   docs     : open USERGUIDE.md for first-run checks and per-machine config."
