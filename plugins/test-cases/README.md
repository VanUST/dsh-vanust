# @cc/dsh-test-cases — host contract (panel and role integration)

The library lives in the repository at `docs/cases/`, one JSON file per case. This plugin is the
only writer of that directory; a human and the client panel go through the same host
tools/commands the model uses, so the schema and the evidence trail cannot drift.

The library records what a role tested **and executes it**: `case_run` runs the case's stored
command, reads the driver's `CASE_SUMMARY`, evaluates the declared checks, hashes the artifacts
and writes the run under `docs/cases/runs/`. A typed threshold (`p95 <= 250`, `axeViolations <= 0`,
a golden hash) is part of the durable case; the measurement is part of the run.

## Role availability

| Preset | Tools |
|---|---|
| `orchestrator` | `case_record`, `case_list`, `case_get`, `case_drift`, `case_gate` — intake and the gate, never a claimed verification |
| `backend`, `ux`, `reviewer`, `critic`, `docs`, `research` | all twelve |
| no preset (standard/headless) | all twelve (deliberate: the library stays usable outside the orchestrated presets) |

The policy is `DEFAULT_ROLE_TOOLS` in `test-cases.mjs` and can be overridden through the row's
`roles` config. Tools are registered per agent on `agent.ctx`, so a preset that is not listed
never sees them.

## Tool contract

All tools return a JSON value; a refusal is `{ ok:false, code, message }` with a stable code.

| tool | rule |
|---|---|
| `case_record` | one case; `automated:true` needs `testPath`+`runCommand`, otherwise a `reason`; optional `checks`, `negativeControl`, `surfaceFiles`, `source`, `linkedTaskId` |
| `case_update` | compare-and-set on `revision`; a changed requirement/command/test/checks returns the case to `stale`; a changed command or test drops the recorded red too |
| `case_verify` | the **manual** report: `{command, output, exitCode}` typed by the caller, stamped `source: manual`; automated passes need the observed red run of the same command |
| `case_run` | **executes** the stored `runCommand` (1–5 runs, timeout) and records the measured result; `mode:"red"` runs the negative control and must FAIL |
| `case_suite` | runs every automated case matching tag/kind/status, records each, writes `docs/cases/runs/suites/<id>.json` |
| `case_gate` | read-only verdict: which linked AUTOMATED cases are not verified |
| `case_list` / `case_get` | summaries with counts / the full record |
| `case_supersede` / `case_deprecate` | closed status, requirement kept |
| `case_remove` | the only destructive verb, terminal status only, audit line in `docs/cases/.removed.jsonl` |
| `case_drift` | rehashes surface files, degrades a missing test; only `verified`/`failing`/`flaky` can go stale |

Refusal codes include `CASE_NOT_FOUND`, `CASE_EXISTS`, `REVISION_REQUIRED`, `REVISION_CONFLICT`,
`CASE_CLOSED`, `AUTOMATED_REQUIRES_TEST`, `DOCUMENTED_REQUIRES_REASON`, `NOT_AUTOMATED`,
`TEST_REQUIRED`, `RED_FIRST_REQUIRED`, `NEGATIVE_CONTROL_REQUIRED`,
`NEGATIVE_CONTROL_DID_NOT_FAIL`, `METRIC_REQUIRED`, `CHECKS_REQUIRE_AUTOMATED`,
`BASELINE_REQUIRES_PASS`, `BASELINE_UNSUPPORTED`, `EMPTY_SUITE`, `COMMAND_MISMATCH`,
`EVIDENCE_REQUIRED`, `EVIDENCE_NOT_GREEN`, `SELF_SUPERSEDE`, `CASE_UNREADABLE`, `INVALID_CASE`,
`INVALID_CHECKS`.

## The runner and the driver contract

`case_run` invokes the case's `runCommand` with:

| env | value |
|---|---|
| `CASE_ID` / `CASE_RUN_ID` | the case and the attempt |
| `CASE_SUMMARY` | path the driver writes its measurements to |
| `CASE_ARTIFACTS` | directory the driver writes screenshots/traces/JSON into |
| `CASE_NEGATIVE_CONTROL` | only for `mode:"red"`: the control name the driver must break on |

The driver writes `CASE_SUMMARY` (all keys optional):

```json
{
  "metrics": { "p95": 212, "axeViolations": 0, "consoleErrors": 0 },
  "hashes": { "golden": "sha256:…" },
  "artifacts": ["home-1440.png", "a11y.json"],
  "notes": "optional"
}
```

The case declares the thresholds it wants evaluated:

```json
"checks": [
  { "name": "p95 latency", "metric": "p95", "op": "<=", "threshold": 250, "unit": "ms" },
  { "name": "axe serious", "metric": "axeViolations", "op": "<=", "threshold": 0 },
  { "name": "golden", "metric": "golden", "op": "==", "expected": "sha256:…" },
  { "name": "p95 ratchet", "metric": "p95", "op": "<=", "baseline": true, "band": 0.1 }
]
```

Rules the runner enforces:

- the exit code is always a check (`exit code == 0`);
- a declared metric the summary does not carry **fails** (`metric_missing`), it does not pass;
- `runs: N` keeps the series, reports median/p95, and a mixed outcome is status `flaky`;
- a `baseline` check compares against `baseline.metrics[metric]`; a failure is the regression;
- `setBaseline: true` seeds the baseline from a PASSING run only, using each metric's median;
- a timeout is a failed run (per-run timeout, 1–600 s);
- the run record carries `commandSha256`, `head`, `dirty`, exit code, duration, stream paths,
  checks and the hashed artifacts.

**A measured red is required before `verified`.** For an automated case with no recorded red,
a green run is stored and returns `needsRed: true` — the case stays unverified. Record the red
with `case_run { mode: "red" }`: the driver receives `CASE_NEGATIVE_CONTROL` and must exit
non-zero for the control to count. `case_verify` remains for a human observation and is stamped
`source: manual`.

## Stored record (`docs/cases/<id>.json`)

```json
{
  "schemaVersion": 1,
  "id": "kebab-title",
  "title": "…", "requirement": "…", "kind": "regression|scenario",
  "status": "unverified|verified|failing|flaky|stale|superseded|deprecated",
  "source": "human|agent",
  "automated": true,
  "testPath": "docs/cases/tests/x.test.mjs", "runCommand": "node --test …",
  "checks": [{ "name": "p95", "metric": "p95", "op": "<=", "threshold": 250, "unit": "ms" }],
  "negativeControl": "optional driver control name",
  "baseline": { "metrics": { "p95": 200 }, "at": "…", "runId": "…", "commit": null },
  "steps": ["…"], "expected": "…", "fixture": "optional", "tags": ["…"],
  "surfaceFiles": [{ "path": "src/x.mjs", "sha256": "…" }],
  "linkedTaskId": "optional",
  "revision": 3, "createdAt": "…", "updatedAt": "…", "createdBy": "…",
  "lastVerified": { "at": "…", "command": "…", "exitCode": 0, "source": "runner|manual", "runId": "…" },
  "runs": [{ "runId": "…", "mode": "green|red", "exitCode": 0, "timedOut": false, "durationMs": 812,
             "checks": [{ "name": "exit code", "pass": true }], "artifacts": [], "head": "…", "dirty": false,
             "stdout": "docs/cases/runs/…/stdout.log", "stderr": "…", "summary": "…" }],
  "redFirst": { "at": "…", "runId": "…", "exitCode": 1, "control": "break", "source": "negative-control|manual" },
  "evidence": { "run": {…}, "redFirst": {…}, "commit": null, "source": "manual" },
  "needsReverification": { "at": "…", "changedFiles": ["…"], "reason": "…" },
  "supersededBy": "optional", "deprecateReason": "optional",
  "history": [{ "revision": 2, "at": "…", "editedBy": "agent", "action": "ran-verified" }]
}
```

A documented-only case has `automated:false`, `reason`, steps and expected instead of
`testPath`/`runCommand`. The last 20 runs are kept; the run directories under
`docs/cases/runs/` are derived output (gitignored) and pruned by the runner.

## Panel contract (implemented)

The **Test cases** panel is a lens over the same host command `/test-cases <json>`. It adds a
**Run** action on the case detail (the measured path: `op:"run"`), renders the last measured run
with its checks and artifacts, marks provenance (`measured` vs `reported`), labels `flaky`, and
keeps the manual form as **Record manual run**.

| op | tool | notes |
| --- | --- | --- |
| `list` / `detail` / `get` | `case_list` / `case_get` | summaries with counts / full record |
| `run` | `case_run` | executes the stored command; refusal codes are shown and the detail reloads |
| `suite` / `gate` | `case_suite` / `case_gate` | available to a client, not needed by the panel |
| `update` / `verify` / `deprecate` / `remove` / `drift` | the matching tool | compare-and-set on the revision shown |

## CLI and `make cases`

`plugins/test-cases/bin/cases.mjs` runs the same runner without a harness:

```
node plugins/test-cases/bin/cases.mjs list  [--status s] [--tag t] [--automated]
node plugins/test-cases/bin/cases.mjs run   --id <case> [--runs 1..5] [--set-baseline] [--red --control <name>]
node plugins/test-cases/bin/cases.mjs suite [--tag t] [--kind k] [--status s]
node plugins/test-cases/bin/cases.mjs gate  (--task <taskId> | --id <case>)
```

`make cases` runs the suite and exits non-zero when a case is not verified (`TAG=…`/`ARGS=…`
narrow it). `make verify` stays the packaging/doc gate.

## Taskboard gate

The plugin provides `ctx.provide('cases', { gateForTask })`. The taskboard looks it up on
`task_close`; a linked AUTOMATED case that is not `verified` refuses the close with
`cases_not_green` and names the case. A profile without this plugin keeps the legacy close.
`case_gate` exposes the same verdict to the orchestrator before it accepts work.
