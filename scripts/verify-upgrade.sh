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

# Node >= 24 is a hard prerequisite, and without this guard its absence is
# misreported: pnpm 11 aborts with `ERR_UNKNOWN_BUILTIN_MODULE` on Node 20, which
# reads like a kit defect rather than an old interpreter on PATH. Fail with the
# actual cause, and name the interpreter in the header so a log pins its environment.
if ! command -v node >/dev/null 2>&1; then
  echo "   [FAIL] node is not on PATH; Node >= 24 is required"
  exit 1
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR}" -lt 24 ]; then
  echo "   [FAIL] Node >= 24 is required; found $(node --version) at $(command -v node)"
  echo "          pnpm 11 and the harness both need it — put a Node 24+ first on PATH and re-run."
  exit 1
fi
echo "   node: $(command -v node) ($(node --version))"

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

# ── the ratchet's own gates, before anything touches a live profile ─────────
# These are the kit's enforcement points for rules that would otherwise be prose:
#   * the static ratchet suite proves the compiler and verifier behave, and that
#     the gate FAILS when it should (the falsification cases);
#   * the ratchet CLI proves the gate is reachable from a shell with real exit
#     codes, which is what makes "a task is not complete until verification
#     passes" a rule something can fail.
# Neither uses the harness, so a red result here is a kit defect rather than an
# upstream one — which is exactly the distinction an upgrade gate needs to make.
if command -v node >/dev/null 2>&1; then
  # Portability and packaging first: these are the checks that catch a defect
  # BEFORE the harness is involved, and a failure here is unambiguously a kit
  # defect rather than an upstream one. The packaging half matters most on this
  # axis — the kit is authored on Windows and deployed to Linux, so a path
  # assumption or a missing `files` entry passes every local run.
  probe "portability and packaging checks" \
    "node '${KIT_DIR}/scripts/check-portability.mjs'"
  probe "the consent surface (no shell mint, no answer-accepting argument)" \
    "node '${KIT_DIR}/scripts/check-consent-surface.mjs' | grep -q 'consent surface ok'"
  probe "instruction routing (only the home rules reach the prompt)" \
    "node '${KIT_DIR}/scripts/check-instruction-routing.mjs' | grep -q 'instruction routing ok'"
  # The panel's browser half never executes under the harness, so a React mistake in
  # it ships silently and is only found by reloading a tab. This renders the real
  # bundle over the real corpus and asserts the UX contract — states filled,
  # provenance outlined, state tones distinct, and every toned pill's text resolving
  # through the installed theme to a colour other than its own fill.
  #
  # The probe requires the theme-dependent half to have RUN: this gate has a harness
  # installed by definition, so a `[SKIP]` here would mean the colour check did nothing
  # while the marker still printed. A standalone run on a machine with no harness may
  # skip; this one may not.
  probe "ADR panel renders its contract from the shipped bundle" \
    "out=\$(node '${KIT_DIR}/scripts/test-adr-panel.mjs'); echo \"\$out\"; echo \"\$out\" | grep -q 'adr panel render ok' && ! echo \"\$out\" | grep -q 'SKIP'"
  # The behavioural half of the gate: these invariants are asserted by driving the
  # production modules, not by a test name, because a test with an empty body passes
  # and a suite prints `fail 0` over an empty file. Measured: a mutation that made a
  # law with no check pass silently survived the gate once the covering test's body
  # was deleted.
  probe "gate invariants (each wrong verdict is refused)" \
    "node '${KIT_DIR}/scripts/check-gate-invariants.mjs' | grep -q 'gate invariants ok'"
  probe "ratchet static suite (schema, compiler, verifier, dynamic, gate)" \
    "node --test '${KIT_DIR}/scripts/test-ratchet.mjs'"
  probe "ratchet CLI runs and reports its own usage" \
    "node '${KIT_DIR}/plugins/ratchet/ratchet-cli.mjs' --help | grep -q 'ratchet'"
  # The CLI must REFUSE an unknown command rather than exiting 0. A gate that
  # silently succeeds on a typo is worse than no gate: CI would stay green while
  # checking nothing.
  probe "ratchet CLI rejects an unknown command (exit 3)" \
    "! node '${KIT_DIR}/plugins/ratchet/ratchet-cli.mjs' verfy >/dev/null 2>&1"
  probe "ratchet CLI rejects an unknown review job (exit 3)" \
    "! node '${KIT_DIR}/plugins/ratchet/ratchet-cli.mjs' review --job nope >/dev/null 2>&1"
  # A shell must not be able to MINT a consent: an agent can run a shell command, so
  # a CLI ratify would be an agent ratify with extra steps. The verb must not exist.
  probe "ratchet CLI has no ratify verb (exit 3, never a mint)" \
    "! node '${KIT_DIR}/plugins/ratchet/ratchet-cli.mjs' ratify --root '${KIT_DIR}' >/dev/null 2>&1"
  # And the read-only half must work and be honest about what waits for a human.
  probe "ratchet CLI lists what waits for a human" \
    "node '${KIT_DIR}/plugins/ratchet/ratchet-cli.mjs' pending --root '${KIT_DIR}' | grep -q 'cannot ratify'"
  # The kit ratchets ITSELF, so the gate has to run the verification it is the gate for.
  # It did not, and the omission was not academic: a law could be deleted from an
  # agent-activated record, recompiled, and this gate still reported PASS over a
  # corpus that `ratchet verify` called a problem one command later. A probe that runs
  # the other probes is not redundant — it is the one that checks the laws they enforce.
  probe "the kit's own corpus verifies against its laws (exit 0, 0 problems)" \
    "node '${KIT_DIR}/plugins/ratchet/ratchet-cli.mjs' verify --root '${KIT_DIR}' | grep -q 'no problems'"
else
  echo "   [FAIL] node is required to run the ratchet gates"
  FAILED=1
fi

# ── composition wiring: the gate row is mounted in the composed tree ────────
probe "composition mounts model-gate" \
  "DSH_HOME='${TEST_HOME}' dsh --profile web --dump-config 2>/dev/null | grep -q 'dsh-model-gate'"

# ── boot: the candidate serves the web app with the kit installed ───────────
echo "   booting throwaway instance on :${PORT}..."
DSH_HOME="${TEST_HOME}" dsh web --port "${PORT}" --no-open >"${TEST_ROOT}/web.log" 2>&1 &
GATE_PID=$!

# 0.1.5+ fences the browser UI behind a login token printed on the boot line, so the
# token IS the readiness signal: the port accepts connections before that line is
# written, and reading the log once — right after a successful curl — produced an empty
# TOKEN and, under `set -e` with `pipefail`, a silent abort with no `[FAIL]` line. Poll
# for the token line itself, bounded, and let a missing one reach the probe as a failure.
TOKEN=""
for i in $(seq 1 60); do
  TOKEN="$(grep -oE 'token=[A-Za-z0-9_-]+' "${TEST_ROOT}/web.log" 2>/dev/null | head -1 | cut -d= -f2 || true)"
  if [ -n "${TOKEN}" ]; then break; fi
  if ! kill -0 "${GATE_PID}" 2>/dev/null; then
    echo "   [FAIL] instance exited during boot (see ${TEST_ROOT}/web.log)"
    exit 1
  fi
  sleep 1
done
if [ -z "${TOKEN}" ]; then
  echo "   [FAIL] no boot token appeared in ${TEST_ROOT}/web.log within 60s"
fi
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
