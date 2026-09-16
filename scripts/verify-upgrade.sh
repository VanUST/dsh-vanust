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

# ── judges that read a probe's output, not only its exit code ───────────────
# `probe` judges an exit code alone, which is right when that exit code IS the verdict.
# Two probes below are not like that: they exit 0 in states this gate must tell apart,
# so the verdict reads a line they print. Each judge is a pure predicate over the
# captured log and the command's exit code, so it can be driven directly by a test
# without running the gate.

# Judge `ratchet falsify`. Its contract is three-way — 0 all applicable cases detected,
# 1 any missed or errored, 2 unusable — and the summary line is the evidence that the
# cases ran; a corpus on which every case is `skipped` exits 0 while proving nothing, so
# at least one `detected` case is required as well. A healthy run on this kit prints
# exactly this shape, measured 2026-09-16:
#   "  3 detected, 0 missed, 3 skipped, 0 out-of-scope, 0 error"
# Every count except `missed`/`error` moves with the corpus, so the stable fields are
# asserted and that literal line is quoted here as the known-good example.
falsify_ok() { # falsify_ok <log-file> <exit-code>
  local log="$1" rc="$2"
  [ "${rc}" -eq 0 ] || return 1
  grep -qE '^  [0-9]+ detected, 0 missed, [0-9]+ skipped, [0-9]+ out-of-scope, 0 error$' "${log}" || return 1
  grep -qE '^  [1-9][0-9]* detected,' "${log}"
}

# Judge the ADR panel render test. It exits non-zero and prints `adr panel render
# FAILED` whenever any assertion fails, and prints the success marker only after every
# non-skipped assertion held, so a skip cannot be mistaken for a pass. It emits a
# `[SKIP]` ONLY when an environmental input is absent and the line names that input: the
# shell theme bundle, or a harness source checkout. A machine with the installed harness
# but no source checkout — this release gate's own machine — therefore skips the
# election while every render assertion passes. Treating that as a failure turned a
# healthy release red, so exactly those TWO documented skips are accepted. The allowlist
# is exact on purpose: an unrecognised skip line — including the "could not drive" error
# path, where the checkout exists but could not be used — fails the gate, so a future
# check cannot opt out by printing a skip, and no `[FAIL]` may accompany a skip.
panel_render_ok() { # panel_render_ok <log-file> <exit-code>
  local log="$1" rc="$2"
  [ "${rc}" -eq 0 ] || return 1
  grep -q 'adr panel render ok' "${log}" || return 1
  if grep -qF '[FAIL]' "${log}"; then return 1; fi
  local skip
  while IFS= read -r skip; do
    [ -n "${skip}" ] || continue
    case "${skip}" in
      '  [SKIP] every toned control is legible against its own fill — no installed shell theme to resolve against') ;;
      '  [SKIP] the panel wins the composer seat in a real election — no ui-slots source found; set HARNESS_DIR to a harness checkout') ;;
      *) return 1 ;;
    esac
  done < <(grep -F '[SKIP]' "${log}" || true)
  return 0
}

# probe_falsify <name> <root> — runs the breaker and judges its summary. Falsify MUTATES
# the project and restores it, so it must not run concurrently with a probe that reads the
# project. The probes in this script are sequential calls, and the only background process
# is the throwaway web boot, which starts after every kit probe has finished — so a plain
# call here is safe. If this gate ever gains parallel probes, this one must be serialised
# against them.
probe_falsify() { # probe_falsify <name> <root>
  local name="$1" root="$2" log="${TEST_ROOT}/falsify.log" rc=0
  node "${KIT_DIR}/plugins/ratchet/ratchet-cli.mjs" falsify --root "${root}" >"${log}" 2>&1 || rc=$?
  cat "${log}"
  if falsify_ok "${log}" "${rc}"; then
    echo "   [ok ] ${name}"
  else
    echo "   [FAIL] ${name} (exit ${rc}; want 'N detected, 0 missed, ... 0 error')"
    FAILED=1
  fi
}

# probe_panel <name> — runs the render test and judges its output, so a documented
# environmental skip is not a failure while a real failure still is. See panel_render_ok.
probe_panel() { # probe_panel <name>
  local name="$1" log="${TEST_ROOT}/adr-panel.log" rc=0
  node "${KIT_DIR}/scripts/test-adr-panel.mjs" >"${log}" 2>&1 || rc=$?
  cat "${log}"
  if panel_render_ok "${log}" "${rc}"; then
    echo "   [ok ] ${name}"
  else
    echo "   [FAIL] ${name} (exit ${rc})"
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
  # The deterministic half of duplicate detection. It runs no model: the corpus is read, two
  # decidable rules are applied, and the exit code is the verdict. Its ADVISORY counterpart
  # (`ratchet_review --job review_duplicates`) spawns a judge and never reaches this exit code.
  probe "duplicate decisions (decidable duplicates fail, merges and one source do not)" \
    "node '${KIT_DIR}/scripts/check-duplicate-decisions.mjs' --root '${KIT_DIR}' | grep -q 'duplicate decisions ok'"
  probe "instruction routing (only the home rules reach the prompt)" \
    "node '${KIT_DIR}/scripts/check-instruction-routing.mjs' | grep -q 'instruction routing ok'"
  # The static line above reads files: a kit-rules provider that stopped
  # contributing the rules — it returned '' — still passed every static check and
  # the model silently received no mandatory rules. This is the behavioural half
  # of the same rule: it builds the real systemPrompt service over a scratch home,
  # applies the shipped kit-rules plugin, assembles and renders the prompt, and
  # requires the home rules file to be in it. A second home is the negative
  # control, so a constant or cached contribution fails too. No credentials, no
  # harness boot and no model call.
  probe "kit-rules contributes the home rules to an assembled prompt" \
    "node '${KIT_DIR}/scripts/probe-dsh-api.mjs' --kit-rules"
  # The panel's browser half never executes under the harness, so a React mistake in
  # it ships silently and is only found by reloading a tab. This renders the real
  # bundle over the real corpus and asserts the UX contract — states filled,
  # provenance outlined, state tones distinct, and every toned pill's text resolving
  # through the installed theme to a colour other than its own fill.
  #
  # The theme and slot-core halves need a harness SOURCE checkout, which this gate does
  # not require — it runs on a machine with the installed harness — so those two checks
  # self-report a `[SKIP]` naming the missing input. `panel_render_ok` accepts exactly
  # those two documented skips, rejects any other skip, and still fails on a `[FAIL]` or
  # a non-zero exit; see its comment for why that distinction is safe.
  probe_panel "ADR panel renders its contract from the shipped bundle"
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
  # And the breaker, because `verify` passing proves nothing on its own: whoever wrote
  # the check already believed it. `falsify` breaks one generic invariant at a time,
  # runs the real verifier, and requires the expected problem code to appear, restoring
  # every mutation afterwards. A case whose check cannot fail is reported `missed` and
  # exits 1, so a corpus where nothing was actually challenged does not pass. This gate
  # runs the breaker on itself and reads the summary line rather than only the exit code
  # (see `falsify_ok`).
  probe_falsify "the kit's own gate falsifies (every applicable case detected)" "${KIT_DIR}"
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
