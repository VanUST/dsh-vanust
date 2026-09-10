#!/usr/bin/env bash
# dsh-kit plugin rebuild — rebuild the model-gate plugin from the harness source
# checkout and pack a fresh tarball into kit/plugins/.
#
# Prereqs (see COMPAT.md): the checkout must sit on the branch/tag matching the
# installed harness version (the plugin builds against that generation's
# packages), and the workspace must be installed (corepack pnpm install) at
# least once.
#
# Usage:
#   HARNESS_DIR=~/deepseek-harness ./scripts/rebuild-plugins.sh
#   ./scripts/verify-upgrade.sh
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESS_DIR="${HARNESS_DIR:-$HOME/deepseek-harness}"
cd "${HARNESS_DIR}"

echo "== rebuilding model-gate from ${HARNESS_DIR} =="
export PATH="$HOME/.npm/node/bin:$PATH"

corepack pnpm exec tsc -b packages/host/model-gate

echo "   bundling host (full host pass)..."
corepack pnpm exec tsdown --env.DSH_BUILD_FACE host

echo "   packing into ${KIT_DIR}/plugins..."
(cd packages/host/model-gate \
  && corepack pnpm pack --out "${KIT_DIR}/plugins/model-gate-$(node -p "require('./package.json').version").tgz")

echo "== done — now reinstall on this machine and run the gate: =="
echo "   cd \$DSH_HOME/profiles/web && corepack pnpm add ${KIT_DIR}/plugins/*.tgz"
echo "   ${KIT_DIR}/scripts/verify-upgrade.sh"
