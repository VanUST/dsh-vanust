---
id: "0092"
title: The ingestion-ratify law is bound to the tests that drive its three fail-closed states
type: adr
status: proposed
author:
  authority: agent
  name: deepseek-flash
created: "2026-09-30T12:40:00Z"
source:
  kind: file
  path: docs/ratchet/sources/2026-09-30-bind-the-ingestion-ratify-law.md
  hash: sha256:2b2642b30d4c6235cb6b71233f96c84709fa37418f4df7609d0c83647b155c2c
zones:
  - shipped-plugins
  - kit-tooling
supersedes: []
approves: []
laws:
  - op: remove
    id: shipped-plugins.ingestion-ratifies-only-a-record-it-wrote
    checks: []
    unenforced: "a removal carries no constraint to check; the compiler's authorisation rule is what refuses it until this amendment is ratified"
  - op: upsert
    id: shipped-plugins.ingestion-ratifies-only-what-it-wrote-and-proves-it
    statement: Ingestion puts a decision to the human only after it has written it, and reports rather than mints when the record was not written, no question channel is available, or the answer cannot be read.
    checks:
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: a supplied judge result and a stub channel put the new decision to the human, and an approval is written for it
        timeoutMs: 300000
        outputContains: "tool: ratchet_ingest_source runs, and ratify puts the new decision to the human in the same call"
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: ingestion with no record to consent to asks nothing and mints nothing
        timeoutMs: 300000
        outputContains: "tool: ingestion with ratify mints nothing when the record was not written"
      - type: command
        run: node --test scripts/test-ratchet.mjs
        expects: with no channel reachable, and with a live channel whose answer names an option the ratchet never offered, nothing is minted; the same call with a readable answer writes exactly one approval
        timeoutMs: 300000
        outputContains: "tool: ingestion mints nothing when no channel can be asked, nor when the answer cannot be read, and mints when it can"
---

## Context

ADR 0015 (ratified by 0020) declares the ingestion-ratify law and leaves it unenforced. Its
note says the behaviour is asserted by two tests in `scripts/test-ratchet.mjs` but that no
gate-level check binds them, "because the suite is a single `node --test` invocation that
prints TAP rather than a stable marker line", and that it "becomes enforceable when a
dedicated invariant script drives the tool into the three fail-closed states".

Both halves of that reason are now false. ADR 0044 introduced `outputContains` on a
`command` check the day after the note was written, and in-force laws already bind that suite
by a TAP test name. And two of the three fail-closed states the law names — "no question
channel is available" and "the answer cannot be read" — had no test at all, so binding the
two tests the note named would have enforced a statement broader than its check.

## Decision

The law id is removed and the statement restated under
`shipped-plugins.ingestion-ratifies-only-what-it-wrote-and-proves-it`, with three `command`
checks on `node --test scripts/test-ratchet.mjs`, each naming the test that carries one part
of the statement. A new test drives the third and fourth cases through
`ratchet_ingest_source` with `ratify: true`: no channel at all, and a live channel whose
human selects a label the ratchet never offered. Both must mint nothing and write no
approval ADR, and the same call with a readable answer must write exactly one, so the two
refusals cannot pass on a tool that merely never consents.

The amendment changes no statement and no behaviour. It retires a stale reason and adds the
check the note asked for, in the form the corpus has used since ADR 0044.

## Reasoning

See `docs/ratchet/sources/2026-09-30-bind-the-ingestion-ratify-law.md` for the observation,
the three-case measurement with its falsification, and the alternatives that were rejected —
correcting the ratified text in place, binding only the two existing tests, and writing the
dedicated invariant script the note proposed.

## Consequences

- The corpus no longer holds a ratified reason that another law's check disproves.
- The law is enforced for all three fail-closed states, not the two the old note accounted
  for. The source of the new test records what each case is and why the success case sits
  beside them.
- ADR 0015 keeps its text and its force: the amendment removes one law id and restates the
  same statement, so nothing a reader of 0015 was told stops being true, and the original
  consent that put that statement in force is not disturbed.
