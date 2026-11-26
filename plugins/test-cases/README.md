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
| `backend` | `case_record`, `case_update`, `case_verify`, `case_run`, `case_suite`, `case_get`, `case_list` — the role that owns the case repairs its text and records the observation |
| `reviewer` | `case_get`, `case_list`, `case_run`, `case_gate`, `case_verify` — records an observation, never edits the case it judges |
| `critic` | `case_get`, `case_list`, `case_run` |
| `tester` | `case_record`, `case_update`, `case_verify`, `case_run`, `case_suite`, `case_gate`, `case_list`, `case_get`, `case_supersede`, `case_deprecate` — the independent acceptance tester: authors the cases, measures the red and the green, never edits product code |
| `ux` | `case_record`, `case_list` |
| `research` | `case_get`, `case_list` |
| `docs` | `case_record`, `case_list`, `case_get` |
| `gatherer` | none — an empty row in the map means no case tool at all |
| no preset (standard/headless) | all twelve (deliberate: the library stays usable outside the orchestrated presets; this row is the one place the table leaves the policy) |

Every row above is a row of `DEFAULT_ROLE_TOOLS`, and `test/policy-docs.test.mjs` fails when this
table and that map disagree. `case_update` is deliberately absent from every role that JUDGES the
change: an editor of the case must not be the judge of it. The prompt section a role receives is
generated from its own row by `sectionText`, so it names exactly the verbs that role has.

The policy is `DEFAULT_ROLE_TOOLS` in `test-cases.mjs` and can be overridden through the row's
`roles` config. Tools are registered per agent on `agent.ctx`, so a preset that is not listed
never sees them.

## Tool contract

All tools return a JSON value; a refusal is `{ ok:false, code, message }` with a stable code.

| tool | rule |
|---|---|
| `case_record` | one case; `automated:true` needs `testPath`+`runCommand`, otherwise a `reason`; optional `checks`, `negativeControl`, `source`, `linkedTaskId`, `purpose`. An automated ACCEPTANCE case also needs a non-empty `surfaceFiles` (`SURFACE_FILES_REQUIRED`). The AUTHOR is taken from the calling session (`authorPreset`, `authorSessionId`); an agent that names another author is refused `AUTHOR_IMMUTABLE`, and its `authorRole` is its own preset. For an automated case the sha256 of `testPath` is frozen as `testHash` |
| `case_update` | compare-and-set on `revision`, and **the author's or a human's** (`AUTHOR_ONLY` for any other agent); re-attribution is refused (`AUTHOR_IMMUTABLE`). A changed requirement, expected outcome, steps, checks, surface list, automation or test binding returns the case to `stale` and drops its evidence and red; a changed command or test also re-pins `testHash` and drops the recorded red |
| `case_verify` | the **manual** report: `{command, output, exitCode, cwd}` typed by the caller, stamped `source: manual`, the directory recorded with it. On an AUTOMATED case a manual pass is an OBSERVATION: the case stays `unverified` and `lastVerified` stays null (a case already verified by the runner keeps that verification); a manual failure sets `failing`. A documented-only case is unchanged |
| `case_run` | **executes** the stored `runCommand` (1–5 runs, timeout) in `cwd` — absolute or workspace-relative, default the session workspace — and records the measured result with that directory (`cwd`, `cwdRelative`) and WHO ran it (`runBy: {preset, sessionId}`, from the session); `mode:"red"` runs the negative control and must FAIL. Refuses a case with no `testHash` (`TEST_HASH_MISSING`) or whose test file no longer hashes to it (`TEST_CHANGED`). Use `cwd` for a red-first run in a COPY of the tree instead of pinning the command to one checkout |
| `case_suite` | runs every automated case matching tag/kind/status, records each with the same `runBy` and the same test-hash binding, writes `docs/cases/runs/suites/<id>.json`; a case it could not bind is reported with `skipped` and makes the suite not green |
| `case_gate` | read-only acceptance verdict: every linked automated ACCEPTANCE case with its provenance and the reasons it is refused. Independence is judged against the **implementer's preset** read from the task row through the taskboard; an agent cannot name it (the argument is ignored and the answer says so), a human may, and the answer carries `presetSource: "task" \| "argument"`. With no preset it fails closed (`IMPLEMENTER_UNKNOWN`). Every case file that cannot be read is returned in `errors` and makes the verdict not-ok |
| `case_list` / `case_get` | summaries with counts / the full record plus `directories.lastRun` and `directories.lastObservation` — the directory the last measured run and the last manual observation were taken in |
| `case_supersede` / `case_deprecate` | closed status, requirement kept |
| `case_remove` | the only destructive verb, terminal status only, audit line in `docs/cases/.removed.jsonl` |
| `case_drift` | rehashes surface files, degrades a missing test; only `verified`/`failing`/`flaky` can go stale |

Refusal codes include `CASE_NOT_FOUND`, `CASE_EXISTS`, `REVISION_REQUIRED`, `REVISION_CONFLICT`,
`CASE_CLOSED`, `AUTOMATED_REQUIRES_TEST`, `DOCUMENTED_REQUIRES_REASON`, `NOT_AUTOMATED`,
`TEST_REQUIRED`, `RED_FIRST_REQUIRED`, `NEGATIVE_CONTROL_REQUIRED`,
`NEGATIVE_CONTROL_DID_NOT_FAIL`, `METRIC_REQUIRED`, `CHECKS_REQUIRE_AUTOMATED`,
`BASELINE_REQUIRES_PASS`, `BASELINE_UNSUPPORTED`, `EMPTY_SUITE`, `COMMAND_MISMATCH`,
`EVIDENCE_REQUIRED`, `EVIDENCE_NOT_GREEN`, `SELF_SUPERSEDE`, `CASE_UNREADABLE`, `INVALID_CASE`,
`INVALID_CHECKS`, `PINNED_COMMAND` (the command carries an absolute path: make it relative and pass
`cwd`), `CWD_NOT_FOUND`, `CWD_INVALID`.

The provenance refusals: `AUTHOR_ONLY` (the caller is not the recorded author and not a human),
`AUTHOR_IMMUTABLE` (an agent tried to record or re-attribute a case under another author),
`AUTOMATED_IMMUTABLE` and `PURPOSE_IMMUTABLE` (an agent tried to switch automation off, or to move
an automated acceptance case to `implementation`; a human needs `WAIVER_REQUIRED`-style
`{reason, by: "human"}`), `TEST_HASH_MISSING` (no hash was ever recorded: re-record the case or
re-pin the test with `case_update { testPath }`) and `TEST_CHANGED` (the test file's bytes are not
the ones the case recorded).

## Provenance and the acceptance rule

A case says WHO wrote it and WHO ran it, and a task closes only on evidence whose two ends are
different from the session that did the work.

| field | where it comes from | meaning |
|---|---|---|
| `authorPreset` / `authorSessionId` | the CALLING SESSION (`agentPreset` after the tool-families resolution, `session.id`) | who wrote the case. An agent cannot pass a different value (`AUTHOR_IMMUTABLE`), and its `authorRole` is its own preset; a human using the panel may name one |
| `purpose` | `case_record`/`case_update`, default `acceptance` | `acceptance` can close a task; `implementation` is the implementer's own test and never does |
| `testHash` | computed at registration and at every re-pin of `testPath` | the sha256 of the test file the case was written against |
| `lastVerified.source` | `runner` from `case_run`, `manual` from `case_verify` | a measurement or a report |
| `runBy: {preset, sessionId, taskId}` | the session that called `case_run`/`case_suite`, written into `run.json`, the run and `lastVerified`; `taskId` is the case's `linkedTaskId` or null | who ran it, and for which task |

Only a KNOWN preset can be an author or a runner: the list is `KNOWN_PRESETS` in
`lib/acceptance.mjs`, and a test checks it against `DEFAULT_ROLE_TOOLS`, so a preset added to the
tool policy without adding it there fails the suite. A session with no preset records `agent`,
which is not a preset and therefore never counts as independent.

An automated acceptance case linked to a task is acceptable evidence only when ALL of these hold;
each one is a named reason, and `case_gate` returns the whole list per case. An automated
acceptance case must also name at least one `surfaceFiles` entry (a product file its test
exercises): the test hash pins the test, the surface list is what notices a changed product file.
That list is as good as the author's care - a forgotten import is still invisible, and this rule
does not pretend otherwise:

```
CASE_MISSING        the task row names a case that is not in the library any more
CASE_NOT_ACCEPTANCE it is not an automated acceptance case, so it cannot close the task
DEGRADED            its test file is gone, so the case was degraded to documented-only
RUN_ARTIFACT_MISSING the run it names left no artifact (docs/cases/runs/<case>/<runId>/run.json)
RUN_MISMATCH        the run artifact does not match the recorded run
TEST_CHANGED        its test file changed after the verification
STALE               a surface file changed after the verification
SELF_AUTHORED       the case was authored by the implementer
SELF_RUN            the case was run by the implementer
NOT_MEASURED        the last confirmation was reported manually, not measured by a run
UNKNOWN_PRESET      its author or its run is not a known preset (agent, human, standard, unknown)
IMPLEMENTER_UNKNOWN the implementer preset is unknown, so independence cannot be established
LEGACY_NO_AUTHOR    the case records no author
LEGACY_NO_RUN_BY    the case records no preset for the run that verified it
SURFACE_FILES_MISSING it names no surface files, so a changed surface cannot be noticed
TEST_HASH_MISSING   the case records no hash of its test file
NOT_VERIFIED        its status is not verified
```

P2 adds two CONTRACT refusals, and they are not case problems: the task's verification level is
`independent`, and its criteria are not all covered.

```
CRITERIA_REQUIRED  the level is independent and the task states no criteria, so "another preset checked it" cannot be judged
CRITERIA_UNCOVERED a criterion has no acceptable case that names it (criterionId)
```

A case covers a criterion ONLY when it names it (`case_record criterionId: "AC-1"`) and it is
acceptable evidence: measured, authored and run by another preset, not stale. Level `proof` and
`case` owe no case at all, and the taskboard does not ask this gate for them.

The list is in reporting order: the FIRST reason is the specific fact a closer needs, and the
generic "not verified" is last. The FIRST two are about the link itself: a case the row names but
the library does not hold, and a case that is not an acceptance case.

KNOWN BOUNDARIES (P1, named rather than papered over):

- **B1** - `RUN_ARTIFACT_*` compares the case with the run artifact, it does not sign it. Whoever
  can write both files can forge the pair; closing that is the journal's job.
- **B1'** - the task ROW is trusted host state. An editor of `.dsh/taskboard.json` can empty
  `caseIds` or change the row's `preset`, and the gate then judges the row as written. Detecting a
  hand-edited row is the journal's job (P1), not this rule's.
- **R1** - `surfaceFiles` is a list the author writes: a forgotten import is invisible to this rule.
- **S10** - the CLI's `--board` points the gate at a ledger file. It is a diagnostic for a terminal
  operator, not a close gate: the close is decided by the taskboard service in the host.
- **legacy** - a row without `caseIds` is scanned by `linkedTaskId`, so an unrelated broken file can
  still block it. Re-write the row's links (or re-record its case) to leave the legacy shape.
- **W1 (enforced)** - a wrong-product red runs in a tree that must be REAL: not the workspace, the
  test file present there, and a git checkout whose HEAD is recorded (`WRONG_PRODUCT_TREE_INVALID`
  otherwise). What is not checked is that the tree is *the previous version*: a committed
  implementation that is merely different would pass. Naming that tree is the tester's job.
- **B1 repeat (S4)** - a fake git tree outside the workspace with the correct product bytes, the
  right test and a deliberate break passes every wrong-product check and can close the task. The
  gate checks that the evidence is consistent, not that its author is honest; naming the tree and
  judging the realism of the scenario remain the tester's and the human's job. This is the B1
  forgery boundary, not a path bypass.
- **B2/B3 (P1 boundaries)** - the write scope is a path rule: a hard link (`docs/cases/link.mjs`
  pointing at the product) and a product file that happens to be named `*.test.*` are outside what
  it can see. The scope stops accidents and casual edits, not a determined operator.

A verified-looking record is not enough on its own: the run it names must exist in `runs` as a
passing green run AND as `docs/cases/runs/<case>/<runId>/run.json`, agreeing on
`commandSha256`, `exitCode: 0`, `passed: true` and `runBy`. That check catches a typed-in
verification and an artifact that was edited afterwards. It is NOT a signature: someone who can
write both the case file and the run directory can still forge them, which is the journal's job.

A case written before these fields existed stays READABLE (INV-LEGACY), and it blocks
(INV-FAILCLOSED): its verification is not deleted and not accepted silently. Re-record it or run
it again with `case_run` — a measured red plus a measured green by another preset is what makes a
new verification.

```
orchestrator   case_record  ->   reviewer   case_run --red  ->  case_run  ->  verified
                                          (runBy: reviewer)
task_close     reads task.preset (orchestrator for an inline task) and asks the case gate
```

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
  "purpose": "acceptance|implementation",
  "authorPreset": "orchestrator", "authorSessionId": "…", "testHash": "sha256 of testPath",
  "revision": 3, "createdAt": "…", "updatedAt": "…", "createdBy": "…",
  "lastVerified": { "at": "…", "command": "…", "exitCode": 0, "source": "runner|manual", "runId": "…",
                    "runBy": { "preset": "reviewer", "sessionId": "…" } },
  "runs": [{ "runId": "…", "mode": "green|red", "exitCode": 0, "timedOut": false, "durationMs": 812,
             "checks": [{ "name": "exit code", "pass": true }], "artifacts": [], "head": "…", "dirty": false,
             "stdout": "docs/cases/runs/…/stdout.log", "stderr": "…", "summary": "…" }],
  "redFirst": { "at": "…", "runId": "…", "exitCode": 1, "control": "break", "source": "negative-control|manual",
                "redSource": "runner", "runBy": { "preset": "reviewer", "sessionId": "…" } },
  "evidence": { "run": {…}, "redFirst": {…}, "observation": {…, "source": "manual"}, "commit": null, "source": "manual" },
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
node plugins/test-cases/bin/cases.mjs gate  (--task <taskId> | --id <case>) [--implementer <preset>]
node plugins/test-cases/bin/cases.mjs audit [--json]
node plugins/test-cases/bin/cases.mjs deprecate --id <case> --reason <text> [--json]
```

`deprecate` is the retirement path from a shell: it takes the case id and a required reason, moves
the case to `deprecated` with the reason in its history, and keeps its steps. It refuses an unknown
id (`CASE_NOT_FOUND`), a missing reason (`INVALID_CASE`) and an already-retired case (`CASE_CLOSED`)
with exit 2, through the same store function the `case_deprecate` tool uses. When the workspace has a
`state/` ledger it also mirrors the retirement through the same `mirrorCase` the tool's `mirror` hook
calls, so the TEST row turns terminal and the snapshot's TEST figure drops; the output reports that
half separately, and a ledger it cannot open leaves the case retired with `board: not updated`.

`make cases` runs the suite and exits non-zero when a case is not verified (`TAG=…`/`ARGS=…`
narrow it). `make verify` stays the packaging/doc gate. The CLI reads the same acceptance rule as
the host tools, so `gate` needs the preset that did the work (`--implementer`): without it every
acceptance case is refused as `IMPLEMENTER_UNKNOWN` instead of passing because nothing was
compared. A case the suite could not bind to its recorded test bytes is printed as `SKIP` with the
code, never as `PASS`, and a case file that cannot be read makes `gate` exit 1 with the file named.

`audit` is the read-only queue of the cases that cannot prove behaviour yet, in five groups over
`docs/cases/*.json`:

- `documented` — `automated:false`: the case has no driver, only steps and a named reason.
- `unmeasured` — no runner evidence: `lastVerified` is absent or its `source` is not `runner`.
- `exit-code-only` — automated, and every stored run carried a `summaryError`: the run's only
  judgement is its exit code, so the case measured no value of its own.
- `legacy-v1` — `schemaVersion: 1` (the stored shape, see above).
- `missing-surface` — a `surfaceFiles` entry or the `testPath` is not in the workspace: the case
  asserts behaviour whose files are gone. The group prints every missing path, not a title guess.

The groups answer independent questions, so one case can be listed under several of them. `audit`
prints each group's ids and count, exits 0 even when every group is full, and writes nothing: the
records belong to their authors, so the repair is theirs or a human's (`case_update`), not the
reader's. `--json` prints one object (`{ ok, library, total, groups: { <name>: { count, cases } },
errors }`) in which every entry carries the reason it is in the group.

## Taskboard gate

THE TASK ROW NAMES ITS CASES. `case_record { linkedTaskId }` attaches the new case to the row
(`caseIds`), through the taskboard service; without the service the case is still written and the
answer says `linked: false` with a warning, and the orchestrator attaches it with
`task_update { caseIds: [...] }`. The link lives on the row because the library is a directory of
files: a deleted file cannot be distinguished from a task that never had a case.

The plugin provides `ctx.provide('cases', { gateForTask })`. The taskboard looks it up on
`task_close` and passes the row's own `preset` (`orchestrator` for an inline task) and its
`caseIds`. Two modes, and the difference matters:

- **the row names its cases** (`caseIds` is an array): only those ids are judged, and each one
  must BELONG to the row. `CASE_MISSING` for an id that is not in the library (deleting the file
  cannot close the task), `CASE_FOREIGN` for a case whose `linkedTaskId` is another task (its
  evidence is real and about other work), `CASE_UNLINKED` for a case that names no task at all,
  `CASE_UNREADABLE` for a broken linked file (that task alone), `CASE_NOT_ACCEPTANCE` for a
  documented-only or implementation case. An EMPTY list is a task that owes no case - a legitimate
  green, and unrelated broken files in the library do not touch it. A task created through
  `task_create` always states its links, even as `[]`: the absent field is the legacy shape, and a
  fresh task must not inherit that ambiguity.
- **a row written before the link** (no `caseIds`): the previous scan by `linkedTaskId`, where an
  unreadable file blocks every task question because its link is inside the file nobody can read.

A linked automated ACCEPTANCE case that is not acceptable evidence refuses the close with
`cases_not_green`, names the case and says which fact refused it. A row with a role
and no recorded preset passes no preset, and the gate then refuses rather than assume. A profile
without this plugin keeps the legacy close. `case_gate` exposes the same verdict, with the evidence
of every case it judged, before the orchestrator accepts work.

`scripts/independent-verification-proof.mjs` is the end-to-end check: it runs six bypasses
(self-authored confirmation, a manual pass with exit 0, an edited expected outcome, automation
switched off, an edited test file, a legacy verified case) against this tree and against the same
code from `git HEAD`, and shows each one refused now and accepted before, while the independent
run (the orchestrator writes, the reviewer measures) still closes the task.
