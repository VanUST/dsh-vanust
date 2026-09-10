#!/usr/bin/env bash
# dsh-kit upgrade gate — verify the shipped plugin suite against a (possibly
# new) harness version on a THROWAWAY instance BEFORE touching the live profile.
#
# Usage:
#   # 1) install the candidate harness version globally, e.g.:
#   #      npm install -g "@deepseek-ai/dsh@<candidate-version>"
#   # 2) run the gate — it uses whatever `dsh` is on PATH:
#   ./scripts/verify-upgrade.sh
#
# The gate builds a fresh $DSH_HOME from the kit, installs the kit tarballs,
# boots `dsh web` on an isolated port, and probes the surface the kit ships:
# composition wiring (the model-gate row is mounted), web boot, and the cost
# policy itself — a disallowed model must fail with MODEL_NOT_ALLOWED before
# any dispatch, while the default Flash model must pass the gate and fail only
# later (no credentials exist in the throwaway home). PASS means the candidate
# is safe to roll onto the live profile + restart.
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3081}"
TEST_ROOT="$(mktemp -d)"
TEST_HOME="${TEST_ROOT}/home"
PROFILE_DIR="${TEST_HOME}/profiles/web"
BLOCKED_HOME="${TEST_ROOT}/blocked-home"
ALLOWED_HOME="${TEST_ROOT}/allowed-home"

cleanup() {
  if [ -n "${GATE_PID:-}" ]; then kill "${GATE_PID}" 2>/dev/null || true; fi
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

echo "== dsh-kit upgrade gate =="
echo "   dsh : $(command -v dsh || echo MISSING) ($(dsh --version 2>/dev/null | head -1 || echo '?') )"
echo "   kit : ${KIT_DIR}"

# Build the throwaway home from the canonical kit files.
mkdir -p "${PROFILE_DIR}"
cp "${KIT_DIR}/profile/cordis.patch.yml" "${PROFILE_DIR}/cordis.patch.yml"
cp "${KIT_DIR}/profile/package.json" "${PROFILE_DIR}/package.json"
cp "${KIT_DIR}/profile/pnpm-workspace.yaml" "${PROFILE_DIR}/pnpm-workspace.yaml"
echo "   installing plugins into the throwaway profile..."
(
  cd "${PROFILE_DIR}"
  corepack pnpm@11.7.0 add "${KIT_DIR}"/plugins/*.tgz >"${TEST_ROOT}/pnpm-add.log" 2>&1
) || {
  echo "   [FAIL] plugin install in the throwaway profile:"
  tail -5 "${TEST_ROOT}/pnpm-add.log"
  exit 1
}

FAILED=0
probe() { # probe <name> <command-string> — runs the command via bash -c
  local name="$1"; shift
  if bash -c "$*" >/dev/null 2>&1; then
    echo "   [ok ] ${name}"
  else
    echo "   [FAIL] ${name}"
    FAILED=1
  fi
}

# ── composition wiring: the gate row is mounted in the composed tree ────────
probe "composition mounts model-gate" \
  "DSH_HOME='${TEST_HOME}' dsh --profile web --dump-config 2>/dev/null | grep -q 'dsh-model-gate'"

# ── boot: the candidate serves the web app with the kit installed ───────────
echo "   booting throwaway instance on :${PORT}..."
DSH_HOME="${TEST_HOME}" dsh web --port "${PORT}" --no-open >"${TEST_ROOT}/web.log" 2>&1 &
GATE_PID=$!

for i in $(seq 1 45); do
  curl -s -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null && break
  sleep 2
  if ! kill -0 "${GATE_PID}" 2>/dev/null; then
    echo "   [FAIL] instance exited during boot (see ${TEST_ROOT}/web.log)"
    exit 1
  fi
done
# 0.1.5+ fences the browser UI behind a login token printed on the boot line.
TOKEN="$(grep -oE 'token=[A-Za-z0-9_-]+' "${TEST_ROOT}/web.log" | head -1 | cut -d= -f2)"
probe "web boot serves the app (token)" \
  "[ -n '${TOKEN}' ] && curl -sf 'http://127.0.0.1:${PORT}/?token=${TOKEN}' -o /dev/null"
kill "${GATE_PID}" 2>/dev/null || true
wait "${GATE_PID}" 2>/dev/null || true
GATE_PID=""

# ── cost policy: the installed artifact vetoes a disallowed model ───────────
# Runs the packed plugin against the candidate's own cordis in the throwaway
# profile: no credentials, no model dispatch, and it exercises exactly the
# shipped bundle. A disallowed model must fail with MODEL_NOT_ALLOWED before
# the waterfall's base call; a Flash model must reach it.
echo "   probing the installed gate artifact..."
if (cd "${PROFILE_DIR}" && timeout 60 node --input-type=module -e '
  import { Context } from "@deepseek-ai/cordis"
  import * as gate from "@deepseek-ai/dsh-model-gate"
  const ctx = new Context()
  gate.apply(ctx, { enabled: true })
  const base = () => (async function* () {})()
  const call = (model) => {
    try {
      ctx.waterfall("llm/stream", { provider: "deepseek-official", model, messages: [] }, base)
      return "allowed"
    } catch (error) {
      return error?.code ?? "threw-without-code"
    }
  }
  const blocked = call("deepseek-v4-pro")
  const allowed = call("deepseek-flash")
  if (blocked !== "MODEL_NOT_ALLOWED") { console.error("blocked probe:", blocked); process.exit(1) }
  if (allowed !== "allowed") { console.error("allowed probe:", allowed); process.exit(1) }
') >"${TEST_ROOT}/policy.log" 2>&1; then
  echo "   [ok ] disallowed model vetoed, Flash model admitted"
else
  echo "   [FAIL] installed gate artifact:"
  tail -4 "${TEST_ROOT}/policy.log"
  FAILED=1
fi

echo
if [ "${FAILED}" -eq 0 ]; then
  echo "== GATE PASS — safe to roll onto the live profile (back up first, reinstall tarballs, restart dsh web) =="
else
  echo "== GATE FAIL — do NOT upgrade the live profile; see COMPAT.md and the logs above =="
  exit 1
fi
