# Acceptance cases measure behaviour

Status: **the case-library contract** (the runner, typed checks, suite, gate and provenance it
describes are shipped). This page owns what a case is, how it is recorded and run, and when it can
close a task; the deployment procedure and the working guide point here instead of restating it.

Subject: the acceptance layer — `@cc/dsh-test-cases`, the library in `docs/cases/`, the tester
preset, and the three Makefile gates (`verify`, `test`, `cases`). Trigger: the owner's four rules
for what a case is.

## 1. The four rules, as invariants

The four statements are one requirement seen from four sides: **evidence is a measured interaction
with a public surface, replayed by the workspace, judged against an oracle that did not come from
the code.**

| owner's rule | forbids | requires | becomes checkable as |
|---|---|---|---|
| **R1** a case verifies behaviour | a case that can only be red when a symbol, file, table or paragraph disappears | the product produces a *wrong result* for a real input, and the case notices | a declared failure kind; an interaction with the product (M2, M3) |
| **R2** a case runs automatically; otherwise a step-by-step procedure agents can execute | prose steps nobody ever executed; a driver nobody can compare with what the tester actually did | the script *is* the execution, recorded before the case exists | a probe bound to the driver's bytes (M4) |
| **R3** a case is any ordered set of executable operations and checks | the assumption that a case is a unit-test function | steps, per-step checks, artifacts, numbers read from logs or a benchmark | per-step results in the run record (M5) |
| **R4** a case never checks code, only behaviour | reading source, asserting on internals, grading a document | every judgement arrives through the interface | interactions + a declared surface, plus a lint for the residue (M2) |

Two things must be said about the rules themselves, or they will be applied where they do not
belong:

- **R1 and R4 are the same prohibition**, from the side of the *oracle* (what makes it red) and
  from the side of the *probe* (what it is allowed to touch). They are enforced together or not at
  all.
- **The rules govern the acceptance layer.** The implementer's own tests are white-box on purpose —
  they import modules, they are fast, they are not evidence, and they never close a task. The
  library already has that distinction (`purpose: acceptance | implementation`,
  `plugins/test-cases/README.md:75-82`); R4 must not be read as banning `make test`'s plugin tests,
  or the kit loses the cheap layer and keeps only the expensive one.

## 2. What the harness already enforces

Measured against the four rules, the surprise is that **R3 is largely shipped**, R2's middle step
does not exist at all, and R1/R4 are declarative.

| layer | shipped behaviour | anchor |
|---|---|---|
| execution | `case_run` runs the case's stored command through `ctx.shell` in a host (sandbox, caps, timeout) or `spawnExec` in the CLI; per-run timeout 1–600 s; 1–5 repeats; `head`/`dirty` recorded | `plugins/test-cases/lib/runner.mjs:69`, `:133`, `:203`, `:266` |
| measurement | the driver writes `CASE_SUMMARY` (`metrics`, `hashes`, `artifacts`); the plugin evaluates the comparator, so a claim in the driver's text cannot override the number; a declared metric the summary lacks fails (`metric_missing`) | `plugins/test-cases/lib/checks.mjs:135`; `README.md:184-215` |
| metrics that fit R3 | median/p95 over a series, baseline + `band` ratchet, `flaky` on a mixed series, hashed artifacts | `plugins/test-cases/lib/checks.mjs:184-210` |
| red | `case_run { mode:"red" }` runs the negative control and must fail; a wrong-product red runs in a real git tree (`WRONG_PRODUCT_TREE_INVALID`); `verified` needs a measured red | `README.md:143-146`, `:217-221` |
| provenance | author preset/session from the invocation (`AUTHOR_IMMUTABLE`), `runBy`, `testHash` pinning the test bytes, `realismReviewedBy/At` as an independent sign-off | `README.md:70-86`; `lib/acceptance.mjs:228-233` |
| acceptance rule | an automated acceptance case is acceptable only when measured, not stale, not self-authored, not self-run, author and runner are known presets, criteria covered | `lib/acceptance.mjs:184-272`, `:289-385` |
| consumer | `ctx.provide('cases', { gateForTask })`, consumed by `task_close`; 20 named reasons, first reason first | `plugins/test-cases/test-cases.mjs:518-602`; `README.md:295-321` |
| three gates | `verify` = readers only (portability, docs, glossary, schema bytes, context budget); `test` = plugin tests + proofs; `cases` = runs the library | `Makefile:138-144`, `:152-153`, `:159-160` |

So the work is not "add a runner". The runner, the typed checks, the red, the provenance and the
gate are the expensive parts, and they exist. What is missing is the part that makes the four rules
*hold*: what the case is allowed to touch, how the script is born, and what a run records besides
an exit code.

## 3. Six defects, each measured in this library

### D1. A static check can be an acceptance case

`docs/cases/case-surface-per-role-matches-the-readme-table.json` is `verified`, names `REQ-179`,
and closes a task. Its driver is `plugins/test-cases/test/policy-docs.test.mjs`, which greps a
Markdown table (`:21`, `:71`, `:102`) before it checks the registry (`:114-127`). Both of its runs
record
`"summaryError": "no summary written (CASE_SUMMARY was not used)"` and `"metrics": {}` — the case
measured no number at all; its whole evidence is an exit code from a text comparison. Under R1 this
is not a case: it can be red only when a document and a source map disagree, never when the product
misbehaves.

### D2. A fixture can stand in for the product

`docs/cases/panel-accessibility-stays-clean-under-axe.json` is `verified` and reports
`serious <= 0`, `violations <= 0`. Its driver loads `docs/cases/fixtures/a11y-page.html`
(`docs/cases/drivers/panel-a11y.mjs:24`), i.e. a hand-written page, not the panel. The measurement
is real and about the wrong object: the panel could become inaccessible and the case stays green.
Under R4 the case never touched the product. Nothing in the record says which object was measured —
`surfaceFiles` lists the driver and the fixture, which is a statement about *files*, not about a
surface.

### D3. Nothing records what the driver touched

The record has no `surface` and the run has no interactions. `surfaceFiles` was added for drift
detection — "which product files does this case exercise" — and is the opposite of a surface: it
names the files the author *believes* are involved, never the interface the driver *called*. A test
that imports internals and asserts on their shape satisfies every present rule, including the
`SURFACE_FILES_REQUIRED` one.

### D4. `failsWhen` is untyped, so an existence claim satisfies it

`failsWhen`/`trigger`/`oracle`/`realism` are prose, refused only when empty
(`lib/acceptance.mjs:228`). "The tool is not registered", "the file is absent" and "the page shows
the wrong count" all pass that gate. The record cannot say what *kind* of defect it catches, so the
gate cannot refuse the weakest kind.

### D5. A case can be recorded without ever being executed, and no one can tell

`automated:false` plus a `reason` is a legal terminal shape (`README.md:40-42`), so a case may be
authored from reading and never run. Where a run did happen, the manual path (`case_verify`) records
`{command, output, exitCode, cwd}` typed by the caller (`README.md:44`), and `lastObservation`
stores the directory, not the actions. Nothing links the tester's exploration to the driver's
actions, so R2's step 2 — *verify the script resembles what I did* — has no mechanism and no
evidence today.

### D6. A run is one process and one exit code, so "an ordered set of operations" cannot be judged

`CASE_SUMMARY` carries `metrics`, `hashes`, `artifacts`; a run record carries one `exitCode`, one
`durationMs`, a flat `checks` list (`README.md:225-255`). A driver that opens a page, clicks five
things and then measures a log line reports one metric and one exit code: a failure at operation 4
and a failure at operation 5 are indistinguishable, and "ordered actions" survive only as prose in
`steps`. Every case measured with `CASE_SUMMARY` (including the a11y case above) has this shape.

## 4. The architecture: two shelves, five mechanisms

Each mechanism closes one loop and states what it cannot close. Nothing here contradicts a shipped
rule; the additions are additive fields, one tool, and one gate vocabulary.

### M1. Two shelves, and the gate only reads one

- `verify` — readers of artifacts: paths, packaging, docs, glossary, schema bytes. A rule that can
  only be red on a document belongs here and is called a **check of the tree**, not a case.
- `test` — the implementer's white-box tests (`purpose: implementation`). Fast, allowed to import
  anything, never evidence, never closes a task.
- `cases` — behaviour cases. Every one of them runs something and touches a surface.

The mechanical rule that keeps the shelves apart is M2: **a driver that cannot produce an
interaction with a declared surface is not an acceptance case.** A text comparison cannot produce
one, and a fixture page produces one against the fixture, not against the product's entry.

### M2. Surface and interactions (R1, R4)

An automated acceptance case declares what it talks to:

```json
"surface": { "kind": "http", "entry": "http://127.0.0.1:3080/api/tasks" }
"surface": { "kind": "ui",   "entry": "http://127.0.0.1:3080/panel/tasks" }
"surface": { "kind": "cli",  "entry": "node plugins/test-cases/bin/cases.mjs" }
"surface": { "kind": "process", "entry": "docker compose up -d db-ui" }
"surface": { "kind": "api",  "entry": "@cc/dsh-taskboard#createTask" }
```

`api` is the algorithm's own interface — a public export of the package's declared entry, never an
internal path. That is what makes an algorithmic case legal under R4 while an assertion on a
private helper is not.

The driver reports what it actually did, in `CASE_SUMMARY`:

```json
"interactions": [
  { "kind": "http", "method": "POST", "path": "/api/tasks", "status": 201, "bytes": 412 },
  { "kind": "ui", "url": "/panel/tasks", "action": "click", "target": "[role=button][name=Close]" },
  { "kind": "cli", "argv": ["cases", "close", "T-1"], "exit": 1 },
  { "kind": "process", "event": "ready", "line": "listening on :3080", "afterMs": 812 },
  { "kind": "log", "source": "service.log", "pattern": "requests=1", "count": 1 }
]
```

`case_run` stores them in the run and refuses to verify a v2 acceptance case that has none
(`NO_INTERACTION`), or whose interaction falls outside the declared entry
(`INTERACTION_OUTSIDE_ENTRY`). `case_get` shows them, so a reviewer reads the actions instead of
the author's summary of them.

**Boundary.** Interactions are self-reported, the same class as the run artifact: a driver can
claim an interaction it never made. The default changes though — a doc test now has to *invent* an
interaction, which is a lie with a name, instead of omitting it. If the cost is acceptable on this
host, one real witness closes part of it (**M2b**): the runner already spawns the driver in its own
process group (`lib/runner.mjs:80`), so it can sample the group's descendants and require at least
one whose command line matches the declared `cli`/`process` entry (or a listening port for
`http`/`ui`). That makes "never started the product" impossible; it still does not prove the driver
used *only* the surface.

### M3. A typed failure kind (R1)

`failsWhen` stays the sentence a human reads; a new field says what kind of defect the case can
catch:

```json
"failureMode": "wrong-result"      // a wrong number, state, page, exit code, latency
"failureMode": "missing-behaviour" // the capability is absent or refuses; legitimised by a wrong-product red
"failureMode": "structure"         // a symbol, file, table or paragraph is absent or different
```

An automated acceptance case may not be `structure` (`STRUCTURE_CASE`); a human may waive one with
`{reason, by:"human"}`. `missing-behaviour` is allowed because red-first *is* its evidence: before
the change the product really does have no such behaviour, and the case fails for a user-visible
reason. The existing `realismReviewedBy` sign-off now covers the failure kind as well as the
scenario — it stays a sign-off, not a proof.

### M4. The probe: the script is the execution (R2)

New tool `case_probe(driver, surface, { runs, timeoutMs, cwd })`, for the tester (and for the
implementer, on its own implementation cases):

1. executes a driver that is **not yet a case**, through the same executor as `case_run`;
2. writes `docs/cases/probes/<probeId>/` — `run.json` with the driver's bytes hash, the
   interactions, the summary metrics, the artifacts, `head`/`dirty`, and the calling session and
   preset;
3. returns the probe id and the same output the run would return.

`case_record` on an automated acceptance case then requires `probeId` (`UNOBSERVED`), pins
`testHash` to the probe's driver hash, and renders the record's `steps` **from the probe's
interactions** instead of taking prose. A driver edited after its probe is refused at record time
and at run time (`OBSERVATION_VOID`), because the pinned hash no longer matches.

This is exactly the owner's workflow with the comparison removed by construction:

> 1) execute actions via agent → the probe is that execution; 2) the agent writes down the script
> → the script *is* what the probe ran; 3) it goes to the library → recording copies the observed
> interactions as the case's steps.

**Boundary.** A probe directory can be written by someone who did not run it — the B1 forgery class,
unchanged. What it removes is the *silent* path: a case with no probe cannot be recorded at all
without a human waiver, and a driver that changed after its probe is visibly void.

### M5. Steps, so an ordered set is judged in order (R3)

The driver contract gains `steps`:

```json
"steps": [
  { "id": "open",   "name": "open the panel", "ok": true,  "metrics": { "loadMs": 240 } },
  { "id": "close",  "name": "click Close",    "ok": false, "metrics": {}, "error": "500 from PATCH /tasks/T-1" },
  { "id": "settle", "name": "row leaves the list", "ok": false }
]
```

- a step that reports `ok:false` fails the run and names itself (`step 2 of 3: "click Close"`), with
  its own artifacts under the run directory;
- a check may name a step (`"step": "settle"`), so a metric from one operation is judged without
  collapsing the whole run into one namespace;
- the probe (M4) and the run share the shape, so a probe with steps `open, close, settle` and a
  driver missing `settle` is `STEP_DIVERGED` — the mechanical form of "the script resembles what I
  did".

The contract stays `CASE_SUMMARY` rather than a test framework's own format, on purpose: Node's
runner already gives subtests and switchable reporters, so a `node --test` driver can later map
subtests onto steps through an adapter, while a Playwright walk, a `curl` sequence or a benchmark
loop keeps writing the same JSON without being forced through a test framework.

With M5, the owner's three shapes are ordinary cases: a UI button is `ui` interactions + a step per
action; a log-checking latency budget is a `process` interaction for readiness, a `log`
interaction and a `p95 <= 250` check; an ordered command set is a `cli` step per command.

## 5. The tester's procedure

This is the procedure the tester persona carries (`profile/cordis.patch.yml`):

| # | step | evidence it leaves |
|---|---|---|
| 1 | read the requirement and its acceptance criteria; write the oracle from them, never from the implementation | `oracle`, `criterionId` |
| 2 | explore the product through its public surface (shell, HTTP, browser, the running service) | the tester's session log |
| 3 | encode the exploration as a driver that emits `interactions` and `steps` | the driver file |
| 4 | `case_probe` the driver until it shows the behaviour you saw | probe: interactions, metrics, artifacts, driver hash |
| 5 | `case_record { probeId }` | a case whose steps are the observed interactions, its test bytes pinned |
| 6 | `case_run { mode:"red", redSource:"wrong-product", cwd:<previous tree> }` — it must fail there | measured red, with the tree named |
| 7 | `case_run` green against the change | measured green, checks evaluated |
| 8 | another preset replays it; the gate judges independence from the task row | `runBy`, `authorPreset`, gate verdict |

Rules that ride along: the tester writes only under `docs/cases/` and the test roots
(`profile/cordis.patch.yml:308-320`); a driver's expected result never comes from the code it
tests; when the product passes a case that should have failed, the case is wrong or the red was
never real — say so, do not make it green.

## 6. The gate, and the migration

New reasons, all about the record's shape rather than its evidence:

```
SURFACE_MISSING           an automated acceptance case declares no surface
NO_INTERACTION            its measured run touched no declared surface
INTERACTION_OUTSIDE_ENTRY an interaction is not under the declared entry
STRUCTURE_CASE            failureMode is "structure" (human waiver possible)
UNOBSERVED                no probe ran the driver it was recorded with
OBSERVATION_VOID          the driver's bytes changed after its probe
STEP_DIVERGED             a probed step is missing from the run (P3)
```

Migration is the sensitive part. The library holds records written under the current
`schemaVersion: 1`, and INV-FAILCLOSED says a legacy record blocks rather than passes quietly. The
proposal is therefore: **v2 rules apply to v2 records**; a v1 record keeps its present verdict, and
`make cases --audit` prints the migration queue (exit-code-only cases, cases without a surface,
documented-only cases). A config flag `cases.strict: true` flips the gate to fail-closed on v1 too;
it is flipped when the queue is empty. The two known offenders are fixed in P0 either way, because
they are wrong now, not because of the new schema.

## 7. Phases, each with its proof

**P0 — audit and the static check (no schema change).**
`cases.mjs audit [--json]` lists four groups without writing: `documented` (no driver),
`unmeasured` (no runner evidence), `exit-code-only` (every measured run has no `CASE_SUMMARY`) and
`legacy-v1`. `scripts/check-role-table.mjs` joins `make verify` and refuses a README role row that
disagrees with `DEFAULT_ROLE_TOOLS`.
The text half of `policy-docs.test.mjs` is **not** removed in P0: the case that points at it closes
tasks today, and deleting its driver before the replacement exists would leave that task with no
acceptable evidence. P1 removes it together with re-recording the registration half as an
`api`-surface case.
The a11y case's disposition is the **author's or a human's** edit, not an agent's: the record is
`source: human`, and `case_update` refuses anyone else (`AUTHOR_ONLY`). P0 only puts it in the
audit queue; P1 records the replacement driver against the panel.
*Proof:* `--audit` names the exit-code-only case; the new verify check exits 1 on an edited role row
and 0 after the restore; `git status` shows no case record touched. *Not changed:* schema, runner,
gate.

**P1 — surface, interactions, failure kind (R1, R4).**
Add `surface`, `interactions`, `failureMode`; store interactions in the run; gate reasons
`SURFACE_MISSING`, `NO_INTERACTION`, `INTERACTION_OUTSIDE_ENTRY`, `STRUCTURE_CASE`; `case_get`
shows interactions.
*Proof:* a driver that imports a module and asserts on internals is refused
(`NO_INTERACTION`); the split registration driver passes and its interactions are in `case_get`; a
doc-table case recorded as `structure` is refused by `case_gate` while a `wrong-result` one is not.
*Not changed:* probe, steps.

**P2 — the probe (R2).**
`case_probe`, `probeId`, `OBSERVATION_VOID`, `UNOBSERVED`; steps rendered from the probe.
*Proof:* recording an automated acceptance case without a probe is refused; probe → record → edit
one byte of the driver → `case_run` refuses `OBSERVATION_VOID`; the probe artifact carries the
interactions and the session that produced them.

**P3 — steps (R3).**
`CASE_SUMMARY.steps`, per-step checks, the failed step named in the run, panel and CLI;
`STEP_DIVERGED`.
*Proof:* a three-step driver failing at step 2 reports `step 2 of 3` with its artifact; a probe
with three steps and a driver performing two is refused; a `process` case (start → readiness →
load → log metric → stop) reads its p95 from the service's own log and fails on a 260 ms sample.

**P4 — migration (done).** `cases.strict` is on, the audit queue is empty, README and this
document carry the corrected text, the three words are in the glossary, and the tester persona names
the §5 procedure. *Proof:* `make cases` is green with strict on; the glossary check accepts the
rows; a tester case names the procedure it follows.

## 8. Decisions for the owner

- **Q1. Is a fixture page a legal acceptance surface?** *Proposal: no.* A fixture may back an
  implementation case; an acceptance case must name the product's entry. This is the a11y case.
- **Q2. Is a public exported function a legal surface (`api`)?** *Proposal: yes* — that is the
  algorithm's interface, which is what R4 protects. Non-exported paths never.
- **Q3. Does `automated:false` survive?** *Proposal: only as `observed`* — a case with a probe and
  no driver yet, which cannot close a task and whose age `make cases` reports. No documented-only
  rest state without an executed probe.
- **Q4. When does the gate turn strict on existing records?** *Proposal:* after the audit queue is
  empty, with `cases.strict` as the reversible switch; not immediately.
- **Q5. Who may call `case_probe`?** *Proposal:* the tester for acceptance cases; the implementer
  for its own implementation cases, which never close anything.

## 9. What this architecture still cannot prove

- Interactions and probes are self-reported records on disk; whoever can write the run and the case
  can forge the pair (B1). M2b narrows it; the journal, not this rule, closes it.
- A driver may still read the product's source. The lint (P0's split) refuses the common shape
  (imports of internals, reads of source paths) and a packed-surface isolation mode
  (`surface.isolation: "packed"` — the case runs against the installed artifact, where the source is
  not present) removes the access for the cases that opt in. Neither is a proof.
- `realism`, `failureMode` and the wrong-result judgement are sign-offs by another preset, not
  measurements.
- A probe proves the driver ran on this host and tree; reproducibility across machines depends on
  the case's `fixture` and `cwd` declarations, which stay prose.
