#!/usr/bin/env bash
# dsh-kit plugin rebuild — rebuild the workbench plugin suite from the harness
# source checkout and pack fresh tarballs into kit/plugins/.
#
# Prereqs (see COMPAT.md): the checkout must be pinned to the SAME version as
# the installed harness; the workspace must be installed (corepack pnpm
# install) at least once.
#
# Usage:
#   HARNESS_DIR=~/deepseek-harness ./scripts/rebuild-plugins.sh
#   ./scripts/verify-upgrade.sh
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESS_DIR="${HARNESS_DIR:-$HOME/deepseek-harness}"
cd "${HARNESS_DIR}"

echo "== rebuilding workbench plugins from ${HARNESS_DIR} =="
export PATH="$HOME/.npm/node/bin:$PATH"

corepack pnpm exec tsc -b \
  packages/host/web-workbench \
  packages/client/ui-workbench \
  packages/client/ui-terminal

echo "   bundling host (full host pass)..."
corepack pnpm exec tsdown --env.DSH_BUILD_FACE host

echo "   bundling clients..."
corepack pnpm exec tsdown --config packages/client/ui-terminal/tsdown.config.ts --env.DSH_BUILD_FACE client
corepack pnpm exec tsdown --config packages/client/ui-workbench/tsdown.config.ts --env.DSH_BUILD_FACE client

echo "   packing into ${KIT_DIR}/plugins..."
for p in host/web-workbench client/ui-workbench client/ui-terminal; do
  (cd "packages/${p}" && corepack pnpm pack --out "${KIT_DIR}/plugins/$(basename "${p}")-$(node -p "require('./package.json').version").tgz")
done

echo "== done — now reinstall on this machine and run the gate: =="
echo "   cd \$DSH_HOME/profiles/web && corepack pnpm add ${KIT_DIR}/plugins/*.tgz"
echo "   ${KIT_DIR}/scripts/verify-upgrade.sh"
