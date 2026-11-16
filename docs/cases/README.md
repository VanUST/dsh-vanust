# docs/cases — the observed test-case library

One JSON file per case in this directory. The library is written only by the host tool family
`@cc/dsh-test-cases`; read it, edit it through `case_update` (compare-and-set on `revision`), and
never delete a case — `case_supersede` and `case_deprecate` keep the requirement and its history.

Why it exists: a test someone performed while exploring is knowledge. If it is portable, it
becomes an autotest that the library **executes** (`case_run`); if it is not (needs a browser, a
human judgement, a fixture nobody can seed), it is stored as a documented case with steps and a
reason. Either way the business requirement stays, and a changed surface file or a missing test
marks it **stale** instead of erasing it.

The rule in one line: **observe first, then persist — no speculative tests.**

## Naming

The file name is the case id (kebab-case of the title). `docs/cases/README.md`, `tests/`,
`drivers/`, `runs/` and `fixtures/` are not cases and are skipped by the tools.

## Reading a case

- `status`: `unverified` | `verified` | `failing` | `flaky` | `stale` | `superseded` | `deprecated`
- `source`: `human` (a requirement stated in chat, recorded by the orchestrator, never claimed as
  verified) or `agent`
- `automated: true` → `testPath` + `runCommand`; optional `checks`, `negativeControl`; `runs[]`
  keeps the last 20 measured runs; `lastVerified.source` is `runner` (measured) or `manual`
  (reported); a green run with no recorded `redFirst` is a measurement, not a verification
- `automated: false` → `reason`, `steps`, `expected`
- `surfaceFiles[]` → `{ path, sha256 }` recorded at verification; `case_drift` rehashes them;
  only `verified`/`failing`/`flaky` can go `stale` (an unverified case never claims a regression)
- `history[]` → every revision, who edited it and what action

## Running a case

Automated cases execute the STORED command through `case_run` (host tool), the CLI
(`node plugins/test-cases/bin/cases.mjs run --id <case>`) or `case_suite`. The driver writes a
`CASE_SUMMARY` JSON with `metrics`, `hashes` and `artifacts`; the case declares the thresholds
(`checks`: `{metric, op, threshold|expected|baseline}`). `runs: N` keeps the series and records a
mixed outcome as `flaky`; `setBaseline: true` seeds a ratchet from a passing run.

A `redFirst` is required before an automated case can be `verified`: for a measured red, call
`case_run { mode: "red" }` and let the driver break its own assertion when it sees
`CASE_NEGATIVE_CONTROL`; the manual path through `case_verify` still works and is stamped
`manual`.

Run directories (`runs/<case>/<runId>/`: `stdout.log`, `stderr.log`, the driver's summary,
`run.json` and artifacts) and suite reports (`runs/suites/`) are derived output and gitignored.

## Adding a case by hand

Do not. Use the tools (`case_record` / `case_update`) so the schema and the evidence trail stay
valid; the human client panel is built against the same contract
(`plugins/test-cases/README.md`).
