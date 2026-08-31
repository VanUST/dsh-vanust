#!/usr/bin/env bash
# dsh-kit upgrade gate — verify the plugin suite against a (possibly new)
# harness version on a THROWAWAY instance BEFORE touching the live profile.
#
# Usage:
#   # 1) install the candidate harness version globally, e.g.:
#   #      npm install -g "@deepseek-ai/dsh@<candidate-version>"
#   # 2) (optional) rebuild plugins from source against the matching checkout:
#   #      ./scripts/rebuild-plugins.sh
#   # 3) run the gate — it uses whatever `dsh` is on PATH:
#   ./scripts/verify-upgrade.sh
#
# The gate builds a fresh $DSH_HOME from the kit, boots `dsh web` on an
# isolated port, and probes the whole plugin surface: health, static assets,
# capabilities, WebSocket+PTY round-trip, and boot-graph membership. PASS
# means the candidate is safe to roll onto the live profile + restart.
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3081}"
TEST_ROOT="$(mktemp -d)"
TEST_HOME="${TEST_ROOT}/home"
PROFILE_DIR="${TEST_HOME}/profiles/web"

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

BASE="http://127.0.0.1:${PORT}"
probe "health"                "curl -sf ${BASE}/wb-api/health"
probe "static xterm.js"       "curl -sf ${BASE}/wb-api/static/xterm.js -o /dev/null"
probe "static xterm.css"      "curl -sf ${BASE}/wb-api/static/xterm.css -o /dev/null"
probe "capabilities"          "curl -sf ${BASE}/wb-api/system/capabilities | grep -q openCommand"
probe "boot graph: terminal"  "curl -sf ${BASE}/ | grep -q ui-terminal/client.js"
probe "boot graph: workbench" "curl -sf ${BASE}/ | grep -q ui-workbench/client.js"

# WebSocket + PTY round-trip (run from the profile so 'ws' resolves).
probe "ws+pty round-trip" "
  cd '${PROFILE_DIR}' && timeout 30 node --input-type=module -e '
    import WebSocket from \"ws\"
    const ws = new WebSocket(\"ws://127.0.0.1:${PORT}/wb-api/terminal/ws?cols=80&rows=24\")
    let out = \"\"
    const timer = setTimeout(() => process.exit(1), 20000)
    ws.on(\"message\", (raw) => {
      const m = JSON.parse(String(raw))
      if (m.type === \"ready\") ws.send(JSON.stringify({ type: \"input\", data: \"echo gate-ok\n\" }))
      else if (m.type === \"output\") {
        out += m.data
        if (out.includes(\"gate-ok\")) { ws.send(JSON.stringify({ type: \"input\", data: \"exit\n\" })) }
      } else if (m.type === \"exit\") { clearTimeout(timer); process.exit(0) }
      else if (m.type === \"error\") process.exit(1)
    })
    ws.on(\"error\", () => process.exit(1))
  '"

kill "${GATE_PID}" 2>/dev/null || true
wait "${GATE_PID}" 2>/dev/null || true
GATE_PID=""

echo
if [ "${FAILED}" -eq 0 ]; then
  echo "== GATE PASS — safe to roll onto the live profile (back up the profile first, reinstall plugins, restart dsh web) =="
else
  echo "== GATE FAIL — do NOT upgrade the live profile; see COMPAT.md and the logs above =="
  exit 1
fi
