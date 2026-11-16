# Case library: from a record of checks to an execution layer

Status: **proposal, not implemented** (2026-11-16). Scope: `@cc/dsh-test-cases` and the library
in `docs/cases/`. The goal stated by the owner: a check that an agent performs by calling tools
- a Playwright walk of a page, a benchmark run whose p95 is read from the output - should become
an autotest the workspace can run and gate on, instead of a paragraph that says it was run.

Today the plugin **records** checks. It does not run them. This document states the shipped
contract, names the six defects that block the goal, and proposes an execution layer in three
parts - RUN, CHECK, GATE - with a phased plan and a proof for each phase.

## 1. What ships today

Nine host tools over one JSON file per case, compare-and-set on `revision`, history that never
deletes, and a panel that is a lens over the same tools:

| tool | what it does | anchor |
|---|---|---|
| `case_record` | one case; `automated:true` needs `testPath`+`runCommand`, otherwise a `reason` | `plugins/test-cases/test-cases.mjs:298` |
| `case_update` | CAS edit; a requirement or test-binding change returns a verified case to `stale` | `test-cases.mjs:365` |
| `case_verify` | records a run **the caller says it made**: red-first (non-zero exit) + green (exit 0) for automated cases | `test-cases.mjs:425`, `:261` |
| `case_list` / `case_get` | summaries / full record | `test-cases.mjs:459`, `:491` |
| `case_supersede` / `case_deprecate` | closed status, requirement kept | `test-cases.mjs:503`, `:530` |
| `case_remove` | the only destructive verb, terminal status only, audit line | `test-cases.mjs:619` |
| `case_drift` | rehashes recorded surface files, degrades a missing test | `test-cases.mjs:553` |

Role surface: the orchestrator gets intake only (`record`/`list`/`get`/`drift`); tester presets
get all nine; a preset not listed gets all nine. A refusal is a value with a stable code, never a
throw (`test-cases.mjs:84`).

The library's own state, measured 2026-11-16 (commands in §6):

- 30 cases: 14 `verified`, 8 `stale`, 5 `unverified`, 3 `deprecated`.
- 11 automated (a real test file + command), 19 documented-only.
- 14 cases drift-flagged right now; 5 of them are recorded `verified` and their surface moved.
- The library's own test (`docs/cases/tests/case-library.test.mjs`, 4 tests) is referenced by
  the case `case-library-drift-rule` and run by **no gate**.

## 2. The six defects that block the goal

### D1. Nothing executes a check - the evidence is a claim

`case_verify` accepts `{command, output, exitCode, at}` from its caller and stores it
(`test-cases.mjs:197`). The only anti-fabrication guard is string equality between
`evidence.command` and the case's `runCommand` (`test-cases.mjs:274-283`); the output and the
exit code are whatever the caller typed. The panel has the same shape: it pre-fills the command
and asks a human to type the output and exit code (`plugins/test-cases/client.js:287`,
`:313-316`). Consequence: a "verified" case is a **recollection**, indistinguishable from a
transcript that was edited. An agent can satisfy every rule without running anything - which is
exactly the failure mode the plugin exists to prevent.

### D2. A check is an exit code, so benchmarks cannot be expressed

The record has no metric: no name, unit, measured value, threshold, tolerance or baseline;
`expected` is prose (`test-cases.mjs:306`). A benchmark that returns p95 = 260 ms against a 250 ms
budget **exits 0**, and the case is `verified`. The same is true of throughput, token cost, FPS,
frame time and every "metric with a threshold" the owner named. There is no place to say "this run
is 4% slower than the recorded baseline" and no ratchet to notice it next time.

### D3. Evidence has no room for what a UI check produces

Evidence is one command, one output string truncated at 8000 characters, one exit code
(`test-cases.mjs:205`). A UX/UI check's real evidence - an accessibility snapshot, a console
error list, an axe violation count, a screenshot or a golden diff, a Playwright trace - has no
field and no file. 19 of 30 cases are documented-only today, and the UI-adjacent ones keep their
proof in prose steps. Consequence: the most expensive checks to perform are the least
reproducible ones.

### D4. Red-first is asserted, and impossible for a new capability

For every automated pass the tool demands a red run with the **same** command, a non-zero exit
(`test-cases.mjs:277-284`). Nothing proves the red happened *before* the fix, or against the old
bytes; it is a second typed string. Worse, for a **new** capability the test does not exist before
the code, so an honest red is impossible: the agent either skips the case, fabricates a red, or
performs a hand-made negative control that the schema cannot name. The repo's own
`design-map-readable-no-label-over-a-node-audit-can-fail` case chose the negative control and
describes it in steps - i.e. the mechanism exists, it is just not modelled.

### D5. Drift detects rot but never re-runs, and it flags cases that were never verified

`case_drift` rehashes `surfaceFiles` and writes `stale` (`test-cases.mjs:583-604`); it never runs
the test. A stale case waits for someone to volunteer. Measured today: 5 recorded-verified cases
are stale, with no mechanism that would ever bring them back to green. And `driftFor`
(`plugins/test-cases/lib/schema.mjs:49-65`) marks a case stale whenever a recorded surface
changed - including an `unverified` case whose surface was recorded at creation but never
verified. The `design-map-readable-...` case is exactly that: nothing was ever verified, and a
drift run would say "stale", which is a lie about history.

### D6. Nothing consumes the library

`make verify` runs two scripts (`Makefile:108-110`) and neither knows about cases. The taskboard
has no `case_` reference at all, so `task_close` cannot be stopped by a red case: the Analysis
Record gate blocks a delegation, but the case library blocks nothing. A requirement can be
accepted while its case is `failing`. Consequence: the library is a diary, not a gate; the drift
numbers above are what a diary looks like after a week.

### Doc and semantic drift (cheap to fix, listed for P0)

- Nine tools, but the package description, the plugin README, the file header and DEPLOYMENT all
  say **eight** (`plugins/test-cases/package.json:4`, `README.md:12-13`, `test-cases.mjs:22`,
  `rules/DEPLOYMENT.md:27`). `case_remove` is missing from every list.
- The README documents a `case_update(..., editedBy?)` parameter; the tool has none - attribution
  comes from the invocation (`README.md:27` vs `test-cases.mjs:404`).
- A **failing** automated run is stored under `evidence.green` (`test-cases.mjs:286`), so the
  record's field name says the opposite of what happened.

## 3. Proposal: RUN, CHECK, GATE

One contract in three layers. The library stays the writer and the repo stays the store; what
changes is that a run produces the evidence, a driver may declare typed checks, and a suite can
gate.

### 3.1 RUN - `case_run` executes the recorded command

```
case_run(id, { mode?: 'green' | 'red', runs?: number, timeoutMs?: number })
```

- Runs the case's **stored** `runCommand` and `testPath` - never a caller-supplied command, so the
  evidence is produced by the plugin, not typed by the model. A command hash is recorded; a case
  whose `runCommand` was edited after the evidence is refused `COMMAND_MISMATCH`.
- Executes through `ctx.shell` (the harness executor: sandbox policy, timeout, output caps,
  `ShellRunResult` with `exitCode`/`timedOut`/`sandbox`), not a private `spawn`. That keeps one
  execution policy in the deployment, and the panel's Run button inherits the same sandbox.
- Writes `docs/cases/runs/<case-id>/<runId>/` (gitignored): `stdout.log`, `stderr.log`,
  `summary.json` (the driver's checks, below), plus any artifacts the driver declared. The record
  keeps a bounded excerpt, the run id, duration, `exitCode`, `timedOut`, the command hash and
  `head`/`dirty` at run time.
- `mode: 'red'` produces a **measured** red instead of a remembered one: run the same command in a
  temporary `git worktree` at the recorded parent commit (configurable per case), or apply a named
  negative control (mutate the assertion/budget and require the run to fail). The record stores
  which control produced the red. A new capability's case is `scenario` + negative control, so
  "the check can fail" is demonstrated rather than asserted.
- `case_verify` stays for a human observation, but its evidence is stamped `manual: true`. Only
  runner evidence can move a case to `verified` (decision Q1).

The UX/UI shape: the driver is a script under `docs/cases/drivers/<id>.mjs` (Playwright + axe,
using the kit's pinned `.tools` libraries), the case's `runCommand` is `node docs/cases/drivers/<id>.mjs`,
and the runner supplies `CASE_SUMMARY` and `CASE_ARTIFACTS` paths. The driver walks the page and
writes the checks - the plugin never learns Playwright.

### 3.2 CHECK - the driver's summary is typed data

The runner sets `CASE_SUMMARY=<path>`; the driver writes:

```json
{
  "checks": [
    { "name": "axe serious violations", "kind": "count", "op": "<=", "threshold": 0, "measured": 0 },
    { "name": "console errors", "kind": "count", "op": "<=", "threshold": 0, "measured": 0 },
    { "name": "p95 latency", "kind": "metric", "op": "<=", "threshold": 250, "unit": "ms", "measured": 212 },
    { "name": "golden screenshot", "kind": "hash", "expected": "sha256:…", "measured": "sha256:…" }
  ],
  "artifacts": ["home-1440.png", "trace.zip", "a11y.json"]
}
```

- The plugin stores the checks verbatim and evaluates the comparator itself when `op`/`threshold`
  are present: `pass` is `measured <= threshold`, so a claim in the driver's text cannot override
  the number. A check without `measured` is refused.
- Benchmark metrics add: `runs: N` (default 3) with **median and p95** across the series, a
  `baseline: { value, runId, commit }`, and `band` (a noise fraction, e.g. `0.1`). A run outside
  `baseline * (1 + band)` is `failing` with the delta and the series, and a baseline cannot be set
  from fewer than N runs. The record keeps the series, so the next regression has a history.
- UI checks are the same mechanism: axe violation counts, console-error counts, missing roles in
  the accessibility snapshot, golden-image hashes. What "correct" means lives in the driver; what
  "passed" means is the typed check.
- Statuses gain `flaky` (N runs, k required - e.g. 3/3 for a hard gate, 2/3 recorded as flaky, not
  verified) and `blocked` (a stand or fixture is unavailable), instead of stretching `failing`.

### 3.3 GATE - a suite, and one consumer that can stop work

- `case_suite({ tag | kind | status })` runs the matching automated cases through the same runner,
  writes `docs/cases/runs/suites/<runId>/report.json` and returns a non-zero exit on any failure.
  Wire it into `make verify` (or a new `make cases`) so the library is run by the gate that
  already exists.
- `case_gate({ linkedTaskId })` is a read-only verdict for the orchestrator and the task rail:
  `{ ok, blockers: [{ id, status, lastRun }] }`. It mirrors the Analysis Record gate's shape
  (`analysis_required`), and the refusal names the case.
- Coupling, to decide (Q3): the taskboard calls a `cases` service (`ctx.provide('cases', …)`, the
  pattern taskboard and analysis already use) and refuses `task_close` while a linked case is
  `failing`/`stale`; or the orchestrator checks `case_gate` before closing. The service is the
  honest owner - a panel close and a model close must meet the same rule.

## 4. Phased plan

**P0 - honesty pass, no new capability.** Fix the tool count in every list (nine, including
`case_remove`), drop the documented `editedBy` parameter, rename `evidence.green` to `run` on
failing/store it honestly, and make `driftFor` flag only `verified`/`failing` cases. Add the
library's own test to `make verify`. *Proof:* `node --test docs/cases/tests/case-library.test.mjs`
green; a drift run on an `unverified` fixture reports no change; `grep -c` shows nine tools in
every list. *Not changed:* the record schema, the panel.

**P1 - the runner.** `case_run` through `ctx.shell`, run directories, provenance, command hash,
`case_verify` stamped `manual`. *Proof:* a case whose command exits 1 becomes `failing` with a
runner run id; editing `runCommand` after a run refuses the next verify; the run directory holds
the logs and a summary; the panel's Run button produces the same evidence as the tool.
*Not changed:* the check schema; existing evidence stays manual.

**P2 - typed checks and metrics.** `CASE_SUMMARY`, metric/count/hash checks, repeats with
median/p95, baseline + band, `flaky`. *Proof:* a benchmark case passes at p95 212 ≤ 250 and fails
at 260 with the delta; an axe summary with one serious violation fails; 2/3 runs on a known-flaky
probe records `flaky`, not `verified`. *Not changed:* the gate, the UI.

**P3 - the suite and the gate.** `case_suite`, report, `make cases`, `case_gate`, the close
coupling. *Proof:* `case_suite --tag regression` exits 1 with one red case and names it;
`task_close` is refused while a linked case is failing, with the case id in the refusal.
*Not changed:* discovery (still a directory scan).

**P4 - measured red.** Worktree red and named negative controls; migrate the 19 documented-only
cases where a driver can be written, keeping the rest documented with a reason. *Proof:* a
regression case records a worktree red at the parent commit; a `scenario` case records its
negative control; the migration report lists what stayed documented and why.

## 5. Non-goals, risks, decisions

- **Not a CI system.** No scheduler, no matrix, no retries across machines. The runner executes on
  this host; a suite is a sequential loop with a timeout.
- **Executing repo content is the risk.** `runCommand` is repository data; a panel Run button is a
  human-initiated shell. Mitigations: the command is displayed before it runs, the harness
  executor applies the session sandbox and timeout, output is capped, and the run records
  `head`/`dirty` so a result cannot be attached to the wrong tree. A per-case allowlist is a
  possible later tightening, not a substitute for the sandbox.
- **Artifacts grow.** Keep runs gitignored with a retention rule (last N per case); the record
  holds hashes, not bytes.
- **`case_list` cost.** Return summaries only and add a `counts` field, so the panel and the
  prompt see "30 cases, 14 stale" without reading every record.
- **Decisions for the owner.**
  - Q1: may manual evidence ever produce `verified`? (Proposal: no - `reported` vs `measured`.)
  - Q2: adopt the `CASE_SUMMARY` contract, or write per-framework adapters? (Proposal: the
    contract - it keeps the plugin tool-agnostic and one file explains every driver.)
  - Q3: who owns the close gate - a `cases` service consumed by the taskboard, or the
    orchestrator checking `case_gate`? (Proposal: the service.)

## 6. Evidence for the numbers in this document

Run in this session (2026-11-16), read-only:

```
# status / automated / source counts over docs/cases/*.json
node -e "…JSON.parse each docs/cases/*.json, count status/automated/source…"
# -> status {verified:14, stale:8, unverified:5, deprecated:3}; automated false:19 true:11

# current drift, computed with the shipped driftFor (no writes)
node -e "import('./plugins/test-cases/lib/schema.mjs').then(({driftFor})=>{ … })"
# -> 30 cases, 14 drift-flagged, 5 of them recorded `verified`,
#    1 of them recorded `unverified` (the design-map-readable case)

# the library's own test, referenced by case-library-drift-rule
node --test docs/cases/tests/case-library.test.mjs   # is NOT run by any Makefile target
```
