# docs/cases — the observed test-case library

One JSON file per case in this directory. The library is written only by the host tool family
`@cc/dsh-test-cases`; read it, edit it through `case_update` (compare-and-set on `revision`), and
never delete a case — `case_supersede` and `case_deprecate` keep the requirement and its history.

Why it exists: a test someone performed while exploring is knowledge. If it is portable, it
becomes an autotest with its exact run command; if it is not (needs a browser, a human judgement,
a fixture nobody can seed), it is stored as a documented case with steps and a reason. Either way
the business requirement stays, and a changed surface file or a missing test marks it **stale**
instead of erasing it.

The rule in one line: **observe first, then persist — no speculative tests.**

## Naming

The file name is the case id (kebab-case of the title). `docs/cases/README.md`, `tests/` and
`fixtures/` are not cases and are skipped by the tools.

## Reading a case

- `status`: `unverified` | `verified` | `failing` | `stale` | `superseded` | `deprecated`
- `source`: `human` (a requirement stated in chat, recorded by the orchestrator, never claimed as
  verified) or `agent`
- `automated: true` → `testPath` + `runCommand`; `evidence.redFirst` (non-zero exit) and
  `evidence.green` (exit 0); `lastVerified`
- `automated: false` → `reason`, `steps`, `expected`
- `surfaceFiles[]` → `{ path, sha256 }` recorded at verification; `case_drift` rehashes them
- `history[]` → every revision, who edited it and what action

## Adding a case by hand

Do not. Use the tools (`case_record` / `case_update`) so the schema and the evidence trail stay
valid; the human client panel is being built against the same contract
(`plugins/test-cases/README.md`).
