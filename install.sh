#!/usr/bin/env bash
# dsh-kit installer — Linux/macOS (fresh machine setup).
#
# What it does:
#   1. checks Node >= 24.9.0 (the pinned harness declares engines node >= 24.9.0),
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
# see docs/GUIDE.md for the working guide and rules/DEPLOYMENT.md for the first-run checks.
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# THE HARNESS PIN HAS ONE OWNER: the `$DSH_VERSION` line of install.ps1. kit-update.mjs reads
# that same declaration and scripts/check-documentation.mjs compares every document with it, so
# this installer DERIVES the value instead of carrying a copy: a bump is one edit and the two
# installers cannot disagree. An empty result stops the install here instead of installing
# whatever npm resolves.
DSH_VERSION="$(sed -n "s/^[[:space:]]*\$DSH_VERSION[[:space:]]*=[[:space:]]*'\([^']*\)'.*/\1/p" "${KIT_DIR}/install.ps1" | head -n 1)"
if [ -z "${DSH_VERSION}" ]; then
  echo "ERROR: install.ps1 declares no \$DSH_VERSION — this installer will not guess a harness version." >&2
  exit 1
fi
PNPM_VERSION="11.7.0"           # matches the harness workspace toolchain
DSH_HOME="${DSH_HOME:-$HOME/.npm/dsh}"

echo "== dsh-kit installer (harness ${DSH_VERSION}) =="

# 1. Node check: >= 24.9.0, MAJOR AND MINOR.
#    The pinned harness declares engines node >= 24.9.0, so Node 24.0-24.8 passed a
#    major-only check and then failed at the harness start - the one moment the
#    installer had stopped explaining. A major above 24 is accepted whatever its minor.
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js not found — install Node >= 24.9.0 first (https://nodejs.org)." >&2
  exit 1
fi
NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null || true)"
case "${NODE_VERSION}" in
  ''|*[!0-9.]*)
    echo "ERROR: cannot read the Node version (expected 24.9.0 or newer, got '${NODE_VERSION}')." >&2
    exit 1
    ;;
esac
NODE_MAJOR="${NODE_VERSION%%.*}"
NODE_REST="${NODE_VERSION#*.}"
NODE_MINOR="${NODE_REST%%.*}"
if [ "${NODE_MAJOR}" -lt 24 ] ||
   { [ "${NODE_MAJOR}" -eq 24 ] && [ "${NODE_MINOR}" -lt 9 ]; }; then
  echo "ERROR: Node ${NODE_VERSION} detected — dsh-kit requires Node >= 24.9.0 (the pinned harness declares engines node >= 24.9.0, so 24.0-24.8 stops at its first start)." >&2
  exit 1
fi
echo "   node: $(node -v) (ok, >= 24.9.0)"

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
  # Keep the machine's layer AND a copy of it next to the original: the file is the
  # only record of the rows this machine added, and "keeping yours" without a copy
  # leaves the next hand-edit as the first thing that can lose it.
  PATCH_BACKUP="${DSH_HOME}/profiles/web/cordis.patch.yml.bak-$(date +%Y%m%d-%H%M%S)"
  cp "${DSH_HOME}/profiles/web/cordis.patch.yml" "${PATCH_BACKUP}"
  echo "   WARN: existing cordis.patch.yml differs from the kit — keeping yours (copy saved at ${PATCH_BACKUP})." >&2
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

# 6. The external binaries the features use: RTK, Marp, Mermaid
#    CLI, D2. They are OPTIONAL by design — every feature degrades and says so — which
#    is exactly why a fresh machine silently lacks them for weeks. Best effort: a
#    failure here names the manual command and never fails the install.
if [ "${SKIP_TOOLS:-0}" != "1" ] && [ -f "${KIT_DIR}/scripts/provision-tools.mjs" ]; then
  echo
  echo "== external tools (SKIP_TOOLS=1 to skip) =="
  node "${KIT_DIR}/scripts/provision-tools.mjs" --apply --kit "${KIT_DIR}" \
    || echo "   some tools are still missing; the features that need them degrade and say so"
fi

# 7. The `dsh` wrapper: pins Node 24 AND converges the machine on the kit before
#    every boot, so a plain `dsh web` picks up new plugins, profile rows and fixes
#    without start.sh. A running server makes it skip (the profile is composed at
#    boot; editing the patch under a live server disposes live plugins). The
#    machine's agent-default-model row is preserved; opt out with DSH_KIT_BOOT=0.
mkdir -p "${DSH_HOME}/bin"
sed "s|@KIT_DIR@|${KIT_DIR}|g" "${KIT_DIR}/scripts/dsh-wrapper.sh" > "${DSH_HOME}/bin/dsh"
chmod +x "${DSH_HOME}/bin/dsh"
echo "   wrapper: ${DSH_HOME}/bin/dsh (converges the kit on every boot)"
case ":$PATH:" in
  *":${DSH_HOME}/bin:"*) ;;
  *) echo "   add to ~/.bashrc AFTER the nvm/npm PATH lines: export PATH=\"${DSH_HOME}/bin:\$PATH\"" ;;
esac

echo
echo "== done =="
echo "   DSH_HOME : ${DSH_HOME}"
echo "   start    : dsh web --port 3080   (converges the kit first; ./start.sh also works)"
echo "   docs     : docs/GUIDE.md (how to work), rules/DEPLOYMENT.md (first-run checks and per-machine config)."
